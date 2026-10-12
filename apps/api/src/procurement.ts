import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {Database,Repository,Table,RecordData} from './db';
import {DOCUMENT_KINDS,DocumentKind} from './database/repository';
import {auditEntityType} from './database/contracts';
import {CatalogFile} from './catalog-import';
import {Actor} from './auth';
import {seed} from './seed';
import {DomainError,databaseError,requireThat} from './errors';
import {Mailer} from './mailer';
import {buildOrderPdf} from './reports';
import {totalMoney} from './money';
import {Criterion,eigenWeights,flattenCriteria,rankAlternatives,monteCarlo,sensitivity,Direction} from './ahp';
import {parse,productSchema,supplierSchema,priceSchema,requestSchema,rfqSchema,quotationSchema,orderSchema,receiptSchema,receiptItemsSchema,evaluationSchema,decisionSchema,auditQuerySchema,movementQuerySchema,documentQuerySchema} from './validation';

export const DEFAULT_CRITERIA:Criterion[]=[{id:'price',name:'Giá',type:'cost'},{id:'quality',name:'Chất lượng',type:'benefit'},{id:'delivery',name:'Giao hàng',type:'cost'},{id:'reputation',name:'Uy tín',type:'benefit'}];
const DEFAULT_MATRIX=[[1,2,4,4],[.5,1,2,2],[.25,.5,1,1],[.25,.5,1,1]];
/** Calendar-day rules (quotation expiry, monthly spend) follow the business's
 * own day, not the UTC day, which changes at 07:00 in Vietnam. */
const BUSINESS_TIMEZONE=process.env.BUSINESS_TIMEZONE||'Asia/Ho_Chi_Minh';
const businessDay=new Intl.DateTimeFormat('en-CA',{timeZone:BUSINESS_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'});
export const businessDate=(instant:Date|string)=>businessDay.format(new Date(instant));
/** Same receipt request regardless of how its timestamp offset is written. */
const receiptInput=(input:any)=>({...input,receivedAt:new Date(input.receivedAt).toISOString(),...(Array.isArray(input.items)?{items:[...input.items].sort((a:any,b:any)=>a.orderLineId<b.orderLineId?-1:1)}:{})});
const WORKSPACE_DAYS=Math.min(3650,Math.max(1,Number(process.env.WORKSPACE_DAYS)||90));
interface AuditNote {detail?:Record<string,unknown>}
export interface CatalogImportResult {committed:boolean;created:{products:number;suppliers:number;prices:number};errors:string[]}
const ROLLBACK=Symbol('rollback');
const entity=(data:object):RecordData=>({id:randomUUID(),createdAt:new Date().toISOString(),...data});
const human=(actor:Actor,roles:string[])=>requireThat(actor.role==='admin'||roles.includes(actor.role),'Bạn không có quyền thực hiện thao tác này',403);
async function need(repo:Repository,table:Table,id:string){const r=await repo.get(table,id);requireThat(r,`Không tìm thấy ${table}: ${id}`,404);return r}
export class Procurement {
 /** Set when real sending is configured; without it queued mail stays queued. */
 mailer?:Mailer;sender='ProcureIQ';
 constructor(public db:Database,public demo=true,private clock:()=>Date=()=>new Date()){}
 private today(){return businessDate(this.clock())}
 async initialize(){await this.db.transaction(r=>seed(r,this.demo))}
 /** Reading a draft never writes a quotation; only valid open RFQ invitations may be extracted. */
 async extractionContext(rfqId:unknown,supplierId:unknown){
  requireThat(typeof rfqId==='string'&&rfqId.length>0&&typeof supplierId==='string'&&supplierId.length>0,'Chọn RFQ và nhà cung cấp');
  return this.db.transaction(async repo=>{
   const rfq=await need(repo,'rfqs',rfqId as string),supplier=await need(repo,'suppliers',supplierId as string);
   requireThat(rfq.status==='open','RFQ đã đóng; không thể trích xuất báo giá mới');
   requireThat(rfq.supplierIds.includes(supplier.id)&&supplier.active!==false,'Nhà cung cấp phải đang hoạt động và được mời trong RFQ');
  },{readOnly:true});
 }
 /** Paged, filtered reads of a document list, including documents no longer in the workspace. */
 async documents(kind:string,query:unknown){
  requireThat((DOCUMENT_KINDS as readonly string[]).includes(kind),'Danh sách không tồn tại',404);const q=parse(documentQuerySchema,query,true);
  return this.db.transaction(repo=>repo.documentPage(kind as DocumentKind,q),{readOnly:true});
 }
 /** Paged, filtered reads of the two logs that only ever grow. */
 async auditLog(query:unknown){const q=parse(auditQuerySchema,query,true);return this.db.transaction(repo=>repo.auditPage({...q,timezone:BUSINESS_TIMEZONE}),{readOnly:true})}
 async stockMovements(query:unknown){const q=parse(movementQuerySchema,query,true);return this.db.transaction(repo=>repo.movementPage(q),{readOnly:true})}
 /** `full` returns every document plus the audit log and stock ledger: reports
  * and tests need that. The web app asks for the workspace instead: master
  * data, documents still in progress, and documents of the last
  * WORKSPACE_DAYS days. Everything older it reads a page at a time. */
 async bootstrap(full=true){return this.db.transaction(async repo=>{
  const logs=full,since=full?undefined:new Date(this.clock().getTime()-WORKSPACE_DAYS*86400000).toISOString();
  const tables:Table[]=['products','suppliers','prices','requests','rfqs','quotations','ahp_sessions','orders','receipts','evaluations','agent_runs','agent_steps','approvals',...(logs?['audit' as const]:[]),'history','outbox'];
  const data:Record<string,any>={};for(const table of tables)data[({ahp_sessions:'ahpSessions',agent_runs:'agentRuns',agent_steps:'agentSteps'} as any)[table]||table]=await repo.list(table,since);
  // Supplier score, forecast and totals each have one implementation, in SQL.
  // AHP and the Agent read the same ones, so a dashboard never disagrees with a ranking.
  const summary=await repo.dashboardSummary(),monthlySpend=await repo.monthlySpend(BUSINESS_TIMEZONE);
  data.inventory=await repo.inventoryForecast();if(logs)data.movements=await repo.inventoryMovements(100000);
  // A total beyond the exact integer range arrives as null and is named here; it is never rounded and never fails the page.
  const warnings=[...(summary.inventoryValue===null?['inventoryValue']:[]),...(monthlySpend.some(month=>month.value===null)?['monthlySpend']:[])];
  data.dashboard={...summary,monthlySpend,supplierPerformance:await repo.supplierPerformance(),forecast:data.inventory,warnings};
  data.criteria=DEFAULT_CRITERIA;data.demoMode=this.demo;data.mailEnabled=!!this.mailer;data.businessDate=this.today();if(since)data.workspaceSince=since;return data;
 },{readOnly:true,isolation:'REPEATABLE READ'})}
 async act(op:string,actor:Actor,body:any={},id?:string):Promise<any>{
  const roles:Record<string,string[]>={request:['buyer','manager'],decide:['manager'],requestApprove:['manager'],receipt:['buyer'],evaluation:['buyer']};human(actor,roles[op]||['buyer']);
  let done:any;
  try {done=await this.db.transaction(async repo=>{
   repo.setActor(actor);
   let result:any;const note:AuditNote={};
   if(op.startsWith('catalog:'))result=await this.catalog(repo,op.split(':'),body,id,note);
   else switch(op){
    case 'request':result=await this.request(repo,body,actor);break;
    case 'requestApprove':{const approval=(await repo.list('approvals')).find(a=>a.requestId===id&&a.gate===1);requireThat(approval,'Không có yêu cầu duyệt',404);result=await this.decide(repo,approval.id,body,actor,note);break}
    case 'decide':result=await this.decide(repo,id!,body,actor,note);break;
    case 'rfq':result=await this.rfq(repo,body);break;
    case 'quotation':result=await this.quotation(repo,body);break;
    case 'quotationUpdate':{const current=await need(repo,'quotations',id!);result=await this.quotation(repo,{...current,...body,rfqId:current.rfqId,supplierId:current.supplierId},id);break}
    case 'ahp':result=await this.compute(repo,body);break;
    case 'approval2':result=await this.approval2(repo,id!);break;
    case 'order':result=await this.order(repo,body);break;
    case 'send':{const order=await need(repo,'orders',id!);await this.ensureOrderApproval(repo,order);result=await this.enqueue(repo,order);break}
    case 'receipt':result=await this.receipt(repo,body,actor);break;
    case 'evaluation':result=await this.evaluation(repo,body,actor);break;
    case 'startAgent':{const product=await need(repo,'products',body.productId);const forecast=(await repo.inventoryForecast()).find(item=>item.productId===product.id)!.forecast;const quantity=body.quantity??Math.max(product.minStock,forecast)-product.stock;requireThat(Number.isSafeInteger(quantity)&&quantity>0&&quantity<=1e7,'Sản phẩm chưa cần nhập thêm hoặc số lượng không hợp lệ');result=await repo.put('agent_runs',entity({productId:product.id,quantity,status:'starting',stage:1,tokensUsed:0,stepCount:0,createdBy:actor.id,demo:this.demo}));break}
    default:throw new DomainError('Thao tác không hỗ trợ',404);
   }
   const entityId=result?.id||id;
   await repo.put('audit',entity({actorId:actor.id,actorName:actor.name,role:actor.role,action:op,entityType:entityId?auditEntityType(op):undefined,entityId,detail:note.detail}));return result;
  })}catch(e:any){throw databaseError(e)??e}
  if(this.mailer&&op==='send')return (await this.deliver(actor,`po:${id}`,true))??done;
  if(this.mailer&&op==='rfq')await this.deliver(actor,`rfq:${done.id}:`,false);
  return done;
 }
 /** Sends the queued mail of one document and records the outcome. A PO counts
  * as sent only once its mail left; a failed PO mail is an error the buyer can retry. */
 private async deliver(actor:Actor,prefix:string,strict:boolean){
  const jobs=await this.db.transaction(async repo=>{const jobs=[];for(const mail of (await repo.list('outbox')).filter(m=>m.messageKey.startsWith(prefix)&&['pending','failed'].includes(m.status))){const order=mail.orderId?await need(repo,'orders',mail.orderId):undefined;jobs.push({mail,order,supplier:await need(repo,'suppliers',mail.supplierId)})}return jobs},{readOnly:true});
  let last:RecordData|undefined;
  for(const {mail,order,supplier} of jobs){
   let failure:any;
   // ponytail: sent outside the transaction, so a crash between sending and recording repeats the mail on retry. A provider idempotency key if that matters.
   try{await this.mailer!({to:mail.to,sender:actor.email,subject:mail.subject,text:mail.text,attachments:order?[{filename:`PO-${order.id.slice(0,8).toUpperCase()}.pdf`,content:await buildOrderPdf(order,supplier,this.sender)}]:undefined})}catch(e){failure=e}
   last=await this.db.transaction(async repo=>{repo.setActor(actor);if(!failure&&order)await repo.put('orders',{...(await need(repo,'orders',order.id)),sentAt:this.clock().toISOString()});return repo.put('outbox',{...mail,status:failure?'failed':'sent'})});
   if(failure){console.warn(`Mail ${mail.messageKey} was not sent: ${failure.message}`);if(strict)throw new DomainError('Chưa gửi được thư PO tới nhà cung cấp. Kiểm tra cấu hình thư rồi bấm "Gửi PO" lại.',502)}
  }
  return last;
 }
 private async catalog(repo:Repository,parts:string[],body:any,id:string|undefined,note:AuditNote){
  const table=parts[1] as Table,method=parts[2];requireThat(['products','suppliers','prices'].includes(table),'Danh mục không hợp lệ');
  if(method==='delete'){await need(repo,table,id!);if(table==='suppliers')requireThat(!(await repo.list('rfqs')).some(r=>r.supplierIds.includes(id)),'NCC đang được sử dụng trong RFQ',409);if(table==='products')requireThat(!(await repo.list('agent_runs')).some(r=>r.productId===id),'Sản phẩm đang được sử dụng trong agent run',409);await repo.remove(table,id!);return {id}}
  const current=id?await need(repo,table,id):undefined;
  if(table==='products'&&current&&body.stock!==undefined)requireThat(body.stock===current.stock,'Tồn kho chỉ thay đổi qua phiếu nhập kho');
  if(table==='products'&&current&&body.unit!==undefined)requireThat(body.unit===current.unit,'Đơn vị tính không đổi được sau khi tạo; hãy xóa mặt hàng chưa dùng rồi tạo lại');
  const schema=table==='products'?productSchema:table==='suppliers'?supplierSchema:priceSchema;
  const values=parse(schema as any,{...current,...body}) as any;
  if(table==='prices'){await need(repo,'products',values.productId);await need(repo,'suppliers',values.supplierId)}
  // The catalog keeps only current values, so the audit row carries what changed.
  if(current){const changes=Object.fromEntries(Object.keys(values).filter(key=>!isDeepStrictEqual(values[key],current[key])).map(key=>[key,{before:current[key],after:values[key]}]));if(Object.keys(changes).length)note.detail={changes}}
  return repo.put(table,current?{...current,...values,updatedAt:new Date().toISOString()}:entity(values));
 }
 /** A request carries 1-50 lines, one per product. The old single-product body
  * (productId, quantity) is the one-line case. Gate 1 approves the whole request. */
 private async request(repo:Repository,body:any,actor:Actor,runId?:string){
  const values=parse(requestSchema,Array.isArray(body?.items)?body:{reason:body?.reason,items:[{productId:body?.productId,quantity:body?.quantity}]});
  requireThat(new Set(values.items.map(item=>item.productId)).size===values.items.length,'Mỗi mặt hàng chỉ xuất hiện một lần trong yêu cầu');
  const lines:string[]=[];
  for(const item of values.items){const product=await need(repo,'products',item.productId);lines.push(`${product.name}: ${item.quantity} ${product.unit}`)}
  const r=await repo.put('requests',entity({reason:values.reason,items:values.items,status:'pending',createdBy:actor.id,runId}));
  const proposal=values.items.length===1?`Nhập ${lines[0]}. ${values.reason}`:`Nhập ${values.items.length} mặt hàng (${lines.join('; ')}). ${values.reason}`;
  const approval=await repo.put('approvals',entity({gate:1,status:'pending',requestId:r.id,runId,proposal}));
  // An administrator's own request needs no second look at gate 1: it is approved as it is filed, and the approval records who and when. Gate 2 still applies.
  if(actor.role!=='admin')return r;
  await this.decide(repo,approval.id,{approved:true,comment:'Quản trị viên lập yêu cầu nên được duyệt ngay.'},actor);return need(repo,'requests',r.id);
 }
 private async decide(repo:Repository,id:string,body:any,actor:Actor,note:AuditNote={}){
  const v=parse(decisionSchema,body),a=await need(repo,'approvals',id);
  note.detail={approved:v.approved,comment:v.comment};
  if(a.status!=='pending'){if(a.status===(v.approved?'approved':'rejected')){requireThat(!v.supplierId||v.supplierId===a.supplierId,'Không được thay NCC của phê duyệt đã quyết định',409);return a}throw new DomainError('Yêu cầu duyệt đã hết hiệu lực hoặc đã quyết định',409)}
  let supplierId:string|undefined;
  if(a.gate===2){const session=await need(repo,'ahp_sessions',a.sessionId);requireThat(session.status!=='stale'&&session.revision===a.revision&&session.consistent,'Phiên AHP đã hết hiệu lực');supplierId=v.supplierId||session.ranking[0].supplierId;requireThat(session.quotationSnapshots.some((q:any)=>q.supplierId===supplierId),'NCC không thuộc phiên AHP');if(v.approved){const valid=await this.eligibleSnapshots(repo,session);requireThat(valid.some((q:any)=>q.supplierId===supplierId),'Báo giá của NCC được chọn đã hết hiệu lực')}if(v.supplierId&&supplierId!==session.ranking[0].supplierId)requireThat(v.comment.trim(),'Chọn NCC khác đề xuất cần lý do');await repo.put('ahp_sessions',{...session,status:v.approved?'approved':'rejected'})}
  // Deciding one's own request is allowed (a single-admin installation has no one else) but is marked for review.
  if(a.gate===1){const request=await need(repo,'requests',a.requestId);if(request.createdBy===actor.id)note.detail={...note.detail,selfApproved:true};await repo.put('requests',{...request,status:v.approved?'approved':'rejected'})}
  const result=await repo.put('approvals',{...a,status:v.approved?'approved':'rejected',supplierId,comment:v.comment,decidedBy:actor.id,decidedAt:new Date().toISOString()});
  if(a.runId){const run=await need(repo,'agent_runs',a.runId);requireThat(run.requestId===a.requestId&&(!a.sessionId||run.sessionId===a.sessionId),'Phê duyệt không thuộc chuỗi dữ liệu của agent',409);await repo.put('agent_runs',{...run,status:v.approved?(a.gate===1?'collecting':'ready_to_order'):'rejected'})}
  return result;
 }
 /** One RFQ per request line. `requestId` alone is enough only while the
  * request has a single line; otherwise the caller names the line. */
 private async rfq(repo:Repository,body:any){
  const v=parse(rfqSchema,body);requireThat(v.requestId||v.requestLineId,'Cần requestId hoặc requestLineId');
  const request=v.requestLineId?(await repo.list('requests')).find(r=>r.items.some((item:any)=>item.id===v.requestLineId)):await need(repo,'requests',v.requestId!);
  requireThat(request,`Không tìm thấy dòng yêu cầu: ${v.requestLineId}`,404);
  requireThat(v.requestLineId||request.items.length===1,'Yêu cầu có nhiều mặt hàng: hãy chọn dòng cần lấy báo giá');
  const line=request.items.find((item:any)=>item.id===v.requestLineId)??request.items[0];
  requireThat(request.status==='approved','Yêu cầu mua chưa được duyệt');requireThat(new Set(v.supplierIds).size===v.supplierIds.length,'NCC không được lặp');
  for(const sid of v.supplierIds){const supplier=await need(repo,'suppliers',sid);requireThat(supplier.active,'NCC đã ngừng hoạt động')}
  const [existing]=await repo.find('rfqs',{requestLineId:line.id});if(existing)return existing;
  const product=await need(repo,'products',line.productId);
  const result=await repo.put('rfqs',entity({requestId:request.id,requestLineId:line.id,supplierIds:v.supplierIds,status:'open',runId:request.runId}));
  for(const sid of v.supplierIds){const supplier=await need(repo,'suppliers',sid);await repo.put('outbox',entity({messageKey:`rfq:${result.id}:${sid}`,type:'RFQ',rfqId:result.id,supplierId:sid,to:supplier.email,subject:`Yêu cầu báo giá ${result.id}`,text:`Vui lòng báo giá ${line.quantity} ${product.unit} ${product.name} (${product.sku}).`,status:this.demo&&!this.mailer?'simulated':'pending'}))}
  return result;
 }
 private async quotation(repo:Repository,body:any,quoteId?:string){
  const v=parse(quotationSchema,body),rfq=await need(repo,'rfqs',v.rfqId);requireThat(rfq.supplierIds.includes(v.supplierId),'NCC không nằm trong RFQ');await need(repo,'suppliers',v.supplierId);requireThat(v.quantity>=rfq.quantity,'Số lượng báo giá chưa đáp ứng RFQ');requireThat(!Number.isNaN(Date.parse(v.validUntil))&&new Date(v.validUntil+'T00:00:00Z').toISOString().slice(0,10)===v.validUntil,'Ngày hiệu lực không hợp lệ');
  totalMoney(rfq.quantity,v.unitPrice,v.vat);
  requireThat(rfq.status!=='closed','Không sửa báo giá sau khi đã tạo PO',409);
  const existing=(await repo.list('quotations')).find(q=>q.rfqId===rfq.id&&q.supplierId===v.supplierId);
  if(existing&&!quoteId){if(JSON.stringify(Object.fromEntries(Object.keys(v).map(k=>[k,existing[k]])))===JSON.stringify(v))return existing;throw new DomainError('NCC đã có báo giá; hãy sửa bản hiện có',409)}
  for(const session of (await repo.list('ahp_sessions')).filter(s=>s.rfqId===rfq.id&&s.status!=='stale')){
   await repo.put('ahp_sessions',{...session,status:'stale'});
   for(const approval of (await repo.list('approvals')).filter(a=>a.sessionId===session.id&&a.status==='pending'))await repo.put('approvals',{...approval,status:'cancelled'});
  }
  return repo.put('quotations',existing?{...existing,...v,updatedAt:new Date().toISOString()}:entity(v));
 }
 private async compute(repo:Repository,body:any){
  const rfq=await need(repo,'rfqs',body.rfqId);requireThat(rfq.status!=='closed','RFQ đã có PO',409);
  const criteria=body.criteria||DEFAULT_CRITERIA,matrix=body.matrix||DEFAULT_MATRIX;
  const root=eigenWeights(matrix),tree=flattenCriteria(criteria,matrix),ids=tree.leaves.map(c=>c.id);requireThat(ids.every(id=>['price','quality','delivery','reputation'].includes(id)),'Tiêu chí chưa có nguồn dữ liệu');requireThat(tree.leaves.length>=2,'Cần ít nhất hai tiêu chí');
  const quotations=(await repo.list('quotations')).filter(q=>q.rfqId===rfq.id&&q.validUntil>=this.today()),suppliers=await repo.list('suppliers'),evaluations=await repo.list('evaluations'),scores=new Map((await repo.supplierPerformance()).map(score=>[score.supplierId,score.score]));
  const valid=quotations.filter(q=>suppliers.find(s=>s.id===q.supplierId)?.active);requireThat(valid.length>=2,'Cần ít nhất hai báo giá còn hiệu lực của NCC đang hoạt động');
  const snapshots=valid.map(q=>{const supplier=suppliers.find(s=>s.id===q.supplierId)!;const feedback=evaluations.filter(e=>e.supplierId===q.supplierId);const actualQuality=feedback.length?feedback.reduce((s,e)=>s+e.qualityScore,0)/feedback.length:q.qualityScore;return {...q,supplierName:supplier.name,criterionInputs:{price:q.unitPrice*(1+q.vat/100),quality:feedback.length?(q.qualityScore+actualQuality)/2:q.qualityScore,delivery:q.deliveryDays,reputation:scores.get(supplier.id)!}}});
  const alternatives=snapshots.map((q:any)=>({supplierId:q.supplierId,supplierName:q.supplierName,values:ids.map(id=>q.criterionInputs[id])})),types=tree.leaves.map(c=>c.type!) as Direction[];
  const ranking=rankAlternatives(tree.weights,alternatives,types),mc=monteCarlo(tree.weights,alternatives,types,body.iterations??1000,body.seed??42,body.uncertainty??.15);
  return repo.put('ahp_sessions',entity({rfqId:rfq.id,runId:rfq.runId,criteria,matrix,...root,weights:tree.weights,cr:Math.max(...tree.treeConsistency.map(g=>g.cr)),consistent:tree.consistent,flattenedCriteria:tree.leaves,treeConsistency:tree.treeConsistency,ranking,monteCarlo:mc,sensitivity:sensitivity(tree.weights,alternatives,types,ids),quotationSnapshots:snapshots,revision:1,status:'draft'}));
 }
 private async approval2(repo:Repository,sessionId:string){
  const session=await need(repo,'ahp_sessions',sessionId);requireThat(session.consistent,'CR vượt 0.1: cần điều chỉnh so sánh cặp');requireThat(!['stale','rejected'].includes(session.status),'Phiên AHP đã hết hiệu lực');
  await this.eligibleSnapshots(repo,session);
  const existing=(await repo.list('approvals')).find(a=>a.sessionId===session.id&&a.revision===session.revision);if(existing)return existing;
  requireThat((await need(repo,'rfqs',session.rfqId)).status!=='closed','RFQ đã có PO',409);
  for(const earlier of (await repo.list('ahp_sessions')).filter(s=>s.rfqId===session.rfqId&&s.id!==session.id&&['pending_approval','approved'].includes(s.status))){
   await repo.put('ahp_sessions',{...earlier,status:'stale'});
   for(const approval of (await repo.list('approvals')).filter(a=>a.sessionId===earlier.id&&a.status==='pending'))await repo.put('approvals',{...approval,status:'cancelled'});
  }
  const rfq=await need(repo,'rfqs',session.rfqId),winner=session.ranking[0],prob=session.monteCarlo.winProbabilities.find((p:any)=>p.supplierId===winner.supplierId)?.probability;
  const proposal=`Đề nghị nhập ${rfq.quantity} đơn vị từ ${winner.supplierName}. Điểm AHP ${(winner.score*100).toFixed(2)}%, CR ${session.cr.toFixed(4)}. Tỷ lệ đứng đầu trong ${session.monteCarlo.iterations} mô phỏng là ${(prob*100).toFixed(1)}% với nhiễu log-uniform ±${(session.monteCarlo.uncertainty*100).toFixed(0)}%. ${this.demo?'Dữ liệu demo mô phỏng.':''}`;
  await repo.put('ahp_sessions',{...session,status:'pending_approval'});
  return repo.put('approvals',entity({gate:2,status:'pending',requestId:rfq.requestId,rfqId:rfq.id,sessionId:session.id,revision:session.revision,runId:session.runId,proposal}));
 }
 private async eligibleSnapshots(repo:Repository,session:RecordData){const suppliers=await repo.list('suppliers');const valid=session.quotationSnapshots.filter((q:any)=>q.validUntil>=this.today()&&suppliers.some(s=>s.id===q.supplierId&&s.active));requireThat(valid.length>=2,'Cần ít nhất hai báo giá còn hiệu lực; báo giá đã hết hạn hoặc NCC ngừng hoạt động');return valid}
 /** Every line of a PO must still stand on an approved session whose gate 2 chose this PO's supplier. */
 private async ensureOrderApproval(repo:Repository,order:RecordData){
  for(const line of order.items){
   const session=await need(repo,'ahp_sessions',line.sessionId),[a]=await repo.find('approvals',{gate:2,sessionId:session.id});
   requireThat(a?.status==='approved'&&a.supplierId===order.supplierId&&session.status==='approved','PO chưa được duyệt đúng phiên AHP',403);
  }
 }
 /** One PO for 1-50 approved sessions that chose the same supplier, one line
  * per RFQ. `sessionId` is the one-line case. Either every line is ordered or
  * none is. */
 private async order(repo:Repository,body:any){
  const v=parse(orderSchema,Array.isArray(body?.sessionIds)?body:{sessionIds:[body?.sessionId]});
  requireThat(new Set(v.sessionIds).size===v.sessionIds.length,'Phiên AHP không được lặp');
  const lines:any[]=[];let supplierId:string|undefined,runId:string|undefined;
  for(const sessionId of v.sessionIds){
   const session=await need(repo,'ahp_sessions',sessionId),rfq=await need(repo,'rfqs',session.rfqId),[a]=await repo.find('approvals',{gate:2,sessionId:session.id});
   requireThat(a?.status==='approved'&&session.status==='approved'&&session.consistent,'Chưa có phê duyệt hợp lệ cho phiên AHP',403);
   const quote=session.quotationSnapshots.find((q:any)=>q.supplierId===a.supplierId);requireThat(quote&&quote.validUntil>=this.today(),'Báo giá được duyệt đã hết hạn hoặc thiếu');
   requireThat((supplierId??=quote.supplierId)===quote.supplierId,'Các phiên trong một PO phải cùng chọn một nhà cung cấp',409);
   requireThat(!lines.some(line=>line.rfqId===rfq.id),'Mỗi RFQ chỉ có một dòng trong PO',409);
   runId=session.runId;
   lines.push({requestId:rfq.requestId,rfqId:rfq.id,sessionId:session.id,productId:rfq.productId,quantity:rfq.quantity,unitPrice:quote.unitPrice,vat:quote.vat,total:totalMoney(rfq.quantity,quote.unitPrice,quote.vat),deliveryDays:quote.deliveryDays,quotationSnapshot:quote});
  }
  // Repeating the same request returns the PO already made; any other overlap is a conflict.
  const ordered=(await repo.list('orders')).filter(o=>o.items.some((item:any)=>lines.some(line=>line.rfqId===item.rfqId)));
  if(ordered.length){
   const [existing]=ordered;
   requireThat(ordered.length===1&&existing.items.length===lines.length&&existing.items.every((item:any)=>lines.some(line=>line.rfqId===item.rfqId&&line.sessionId===item.sessionId)),'RFQ đã có PO từ phiên khác hoặc trong một PO khác',409);
   return existing;
  }
  const supplier=await need(repo,'suppliers',supplierId!);requireThat(supplier.active,'NCC được duyệt đã ngừng hoạt động');
  requireThat(Number.isSafeInteger(lines.reduce((sum,line)=>sum+line.total,0)),'Tổng tiền PO vượt giới hạn chính xác của hệ thống');
  return repo.put('orders',entity({supplierId,status:'ordered',runId:lines.length===1?runId:undefined,items:lines}));
 }
 private async enqueue(repo:Repository,order:RecordData){
  const existing=(await repo.list('outbox')).find(o=>o.messageKey===`po:${order.id}`);if(existing)return existing;const supplier=await need(repo,'suppliers',order.supplierId);
  const text=[`Đơn đặt hàng gồm ${order.items.length} dòng, tổng ${order.total} VND đã gồm VAT:`,...order.items.map((line:any)=>`- ${line.productName} (${line.productSku}): ${line.quantity} ${line.unit} × ${line.unitPrice} VND, VAT ${line.vat}%, giao trong ${line.deliveryDays} ngày`)].join('\n');
  const mail=await repo.put('outbox',entity({messageKey:`po:${order.id}`,type:'PO',orderId:order.id,supplierId:supplier.id,to:supplier.email,subject:`Đơn đặt hàng ${order.id}`,text,status:this.demo&&!this.mailer?'simulated':'pending'}));if(!this.mailer)await repo.put('orders',{...order,sentAt:new Date().toISOString()});return mail;
 }
 /** A receipt covers one or more lines of one PO. The old flat body (quantity,
  * acceptedQuantity) is the one-line case and is kept as sent, so its retries
  * still match. */
 private async receipt(repo:Repository,body:any,actor:Actor){
  const multi=Array.isArray(body?.items);
  const v:any=multi?parse(receiptItemsSchema,body):parse(receiptSchema,body);
  if(multi)v.items=[...v.items].sort((a:any,b:any)=>a.orderLineId<b.orderLineId?-1:1);
  requireThat(Date.parse(v.receivedAt)<=Date.now()+60000,'Ngày nhận không được ở tương lai');
  const existing=(await repo.list('receipts')).find(r=>r.idempotencyKey===v.idempotencyKey);if(existing){requireThat(isDeepStrictEqual(receiptInput(existing.input),receiptInput(v)),'idempotencyKey đã được dùng với nội dung khác',409);return existing}
  const order=await need(repo,'orders',v.orderId);await this.ensureOrderApproval(repo,order);
  requireThat(multi||order.items.length===1,'PO có nhiều dòng: phiếu nhận cần ghi theo từng dòng');
  const items:any[]=multi?v.items:[{orderLineId:order.items[0].id,quantity:v.quantity,acceptedQuantity:v.acceptedQuantity}];
  requireThat(new Set(items.map(item=>item.orderLineId)).size===items.length,'Mỗi dòng PO chỉ xuất hiện một lần trong phiếu nhận');
  for(const item of items){
   const line=order.items.find((candidate:any)=>candidate.id===item.orderLineId);
   requireThat(line,'Dòng nhận không thuộc PO này');
   requireThat(item.acceptedQuantity<=item.quantity,'Số lượng đạt không được vượt số lượng nhận');
   requireThat(line.receivedQuantity+item.quantity<=line.quantity,`Số lượng nhận vượt số lượng PO: ${line.productName}`);
  }
  requireThat(Date.parse(v.receivedAt)>=Date.parse(order.createdAt)-60000,'Ngày nhận không được trước ngày đặt hàng');
  // Inserting the receipt is the whole write: schema triggers add the PO counters, PO status and stock.
  return repo.put('receipts',entity({orderId:v.orderId,receivedAt:v.receivedAt,idempotencyKey:v.idempotencyKey,notes:v.notes,input:v,items,supplierId:order.supplierId,createdBy:actor.id}));
 }
 /** One evaluation per fully received PO. With several lines, each line weighs
  * by its ordered value before VAT, so units of different products are never
  * added together. A one-line PO gives exactly the earlier formula. */
 private async evaluation(repo:Repository,body:any,actor:Actor){
  const v=parse(evaluationSchema,body),order=await need(repo,'orders',v.orderId);requireThat(order.status==='received','Chỉ đánh giá sau khi đã nhận đủ đợt giao của PO');requireThat(!(await repo.list('evaluations')).some(e=>e.orderId===order.id),'PO đã được đánh giá',409);
  const receipts=(await repo.list('receipts')).filter(r=>r.orderId===order.id);
  const scored=order.items.map((line:any)=>{
   const latest=Math.max(...receipts.filter(r=>r.items.some((item:any)=>item.orderLineId===line.id)).map(r=>Date.parse(r.receivedAt))),due=Date.parse(order.createdAt)+line.deliveryDays*86400000;
   return {weight:line.quantity*line.unitPrice,acceptance:line.acceptedQuantity/line.quantity*100,delivery:Math.max(1,100-Math.max(0,Math.ceil((latest-due)/86400000))*10)};
  });
  const total=scored.reduce((sum:number,line:any)=>sum+line.weight,0),weighted=(key:'acceptance'|'delivery')=>scored.length===1?scored[0][key]:scored.reduce((sum:number,line:any)=>sum+line[key]*line.weight,0)/total;
  const acceptanceScore=weighted('acceptance'),deliveryScore=weighted('delivery'),qualityScore=(v.qualityScore+acceptanceScore)/2,overallScore=.5*qualityScore+.3*deliveryScore+.2*v.serviceScore;
  return repo.put('evaluations',entity({...v,qualityScore,reportedQualityScore:v.qualityScore,acceptanceScore,deliveryScore,overallScore,supplierId:order.supplierId,productId:order.items.length===1?order.items[0].productId:undefined,createdBy:actor.id}));
 }
 /** Loads a catalog file in one transaction. Every row is validated and written;
  * without `commit`, or when any row is wrong, the transaction is rolled back.
  * A preview therefore reports exactly what a commit would do, and a file is
  * never half imported. */
 async importCatalog(actor:Actor,file:CatalogFile,commit=false):Promise<CatalogImportResult>{
  human(actor,['buyer']);
  const errors:string[]=[],created={products:0,suppliers:0,prices:0};
  const row=async(where:string,write:()=>Promise<void>)=>{try{await write()}catch(e){if(!(e instanceof DomainError))throw e;errors.push(`${where}: ${e.message}`)}};
  try{await this.db.transaction(async repo=>{
   repo.setActor(actor);
   const key=(text:string)=>text.trim().toLowerCase();
   const products=new Map((await repo.list('products')).map(p=>[key(p.sku),p.id])),suppliers=new Map((await repo.list('suppliers')).map(s=>[key(s.name),s.id]));
   const priced=new Set((await repo.list('prices')).map(p=>`${p.productId}|${p.supplierId}`));
   for(const {line,values} of file.products)await row(`Mặt hàng dòng ${line}`,async()=>{
    const v=parse(productSchema,values);requireThat(!products.has(key(v.sku)),`SKU ${v.sku} đã tồn tại hoặc bị lặp trong file`);
    products.set(key(v.sku),(await repo.put('products',entity(v))).id);created.products++;
   });
   for(const {line,values} of file.suppliers)await row(`Nhà cung cấp dòng ${line}`,async()=>{
    const v=parse(supplierSchema,values);requireThat(!suppliers.has(key(v.name)),`Nhà cung cấp ${v.name} đã tồn tại hoặc bị lặp trong file`);
    suppliers.set(key(v.name),(await repo.put('suppliers',entity(v))).id);created.suppliers++;
   });
   for(const {line,values} of file.prices)await row(`Giá tham khảo dòng ${line}`,async()=>{
    const productId=products.get(key(String(values.sku??''))),supplierId=suppliers.get(key(String(values.supplier??'')));
    requireThat(productId,`không tìm thấy SKU ${values.sku??'(trống)'}`);requireThat(supplierId,`không tìm thấy nhà cung cấp ${values.supplier??'(trống)'}`);
    const v=parse(priceSchema,{productId,supplierId,unitPrice:values.unitPrice,deliveryDays:values.deliveryDays,qualityScore:values.qualityScore});
    requireThat(!priced.has(`${productId}|${supplierId}`),'cặp mặt hàng và nhà cung cấp này đã có giá');
    priced.add(`${productId}|${supplierId}`);await repo.put('prices',entity(v));created.prices++;
   });
   if(errors.length||!commit)throw ROLLBACK;
   await repo.put('audit',entity({actorId:actor.id,actorName:actor.name,role:actor.role,action:'catalog:import',detail:{created}}));
  })}catch(e:any){if(e!==ROLLBACK)throw databaseError(e)??e}
  return {committed:commit&&!errors.length,created,errors};
 }
 async tool(name:string,body:any):Promise<any>{
  requireThat(['detect_need','get_run','prepare_rfq','receive_quotations','evaluate','finalize','report_error'].includes(name),'Tool không hỗ trợ',404);requireThat(typeof body.runId==='string','Tool cần runId');
  try{return await this.db.transaction(async repo=>{
   repo.setActor({id:'agent',name:'AI Agent',role:'agent'},body.runId);
   let run=await need(repo,'agent_runs',body.runId);if(name==='get_run')return {run,approvals:(await repo.list('approvals')).filter(a=>a.runId===run.id),quotations:(await repo.list('quotations')).filter(q=>q.rfqId===run.rfqId)};
   requireThat(name==='report_error'||run.status!=='rejected','Agent run đã bị từ chối',403);requireThat(run.stepCount<30,'Agent vượt giới hạn 30 bước');
   let output:any;
   switch(name){
    case 'detect_need':{let request=run.requestId?await need(repo,'requests',run.requestId):await this.request(repo,{productId:run.productId,quantity:run.quantity,reason:'Agent phát hiện nhu cầu bổ sung tồn kho'}, {id:'agent',name:'AI Agent',role:'agent'},run.id);requireThat(request.runId===run.id,'Request không thuộc run');run={...run,requestId:request.id,status:'waiting_approval_1',stage:1};output={request,approval:(await repo.list('approvals')).find(a=>a.requestId===request.id&&a.gate===1)};break}
    case 'prepare_rfq':{requireThat(run.requestId,'Chưa có yêu cầu mua');const request=await need(repo,'requests',run.requestId),gate=(await repo.list('approvals')).find(a=>a.runId===run.id&&a.gate===1&&a.requestId===request.id);requireThat(request.runId===run.id&&gate?.status==='approved'&&request.status==='approved','Điểm duyệt 1 chưa được chấp thuận',403);const suppliers=(await repo.list('suppliers')).filter(s=>s.active),prices=(await repo.list('prices')).filter(p=>p.productId===run.productId&&suppliers.some(s=>s.id===p.supplierId));const supplierIds=[...new Set(prices.map(p=>p.supplierId))];const rfq=await this.rfq(repo,{requestId:request.id,supplierIds});requireThat(rfq.runId===run.id,'RFQ không thuộc run');run={...run,rfqId:rfq.id,status:'collecting',stage:2};output={rfq,request,product:await need(repo,'products',run.productId),suppliers:suppliers.filter(s=>supplierIds.includes(s.id)),prices,quotations:(await repo.list('quotations')).filter(q=>q.rfqId===rfq.id)};break}
    case 'receive_quotations':{requireThat(run.rfqId,'Chưa có RFQ');const rfq=await need(repo,'rfqs',run.rfqId);requireThat(rfq.runId===run.id&&rfq.requestId===run.requestId,'RFQ không thuộc chuỗi run');const gate=(await repo.list('approvals')).find(a=>a.runId===run.id&&a.gate===1);requireThat(gate?.status==='approved','Điểm duyệt 1 chưa được chấp thuận',403);requireThat(Array.isArray(body.quotations)&&body.quotations.length>=2&&body.quotations.length<=10,'Cần 2 đến 10 báo giá');const quotes=[];for(const q of body.quotations){requireThat(!q.rfqId||q.rfqId===run.rfqId,'Báo giá không thuộc RFQ của run');quotes.push(await this.quotation(repo,{...q,rfqId:run.rfqId}))}output={quotations:quotes};break}
    case 'evaluate':{requireThat(run.rfqId,'Chưa có RFQ');const rfq=await need(repo,'rfqs',run.rfqId);requireThat(rfq.runId===run.id&&rfq.requestId===run.requestId,'RFQ không thuộc chuỗi run');const session=run.sessionId?await need(repo,'ahp_sessions',run.sessionId):await this.compute(repo,{rfqId:run.rfqId});requireThat(session.runId===run.id&&session.status!=='stale','Phiên AHP không thuộc run hoặc đã hết hiệu lực');const approval=await this.approval2(repo,session.id);run={...run,sessionId:session.id,status:approval.status==='approved'?'ready_to_order':'waiting_approval_2',stage:3};output={session,approval,proposal:approval.proposal};break}
    case 'finalize':{requireThat(run.sessionId,'Chưa có AHP được duyệt',403);const session=await need(repo,'ahp_sessions',run.sessionId);requireThat(session.runId===run.id&&session.rfqId===run.rfqId,'Phiên AHP không thuộc chuỗi run',403);const gate=(await repo.list('approvals')).find(a=>a.gate===2&&a.runId===run.id&&a.sessionId===session.id);requireThat(gate?.status==='approved','Điểm duyệt 2 chưa được chấp thuận',403);const order=await this.order(repo,{sessionId:session.id});await this.ensureOrderApproval(repo,order);await this.enqueue(repo,order);run={...run,orderId:order.id,status:'completed',stage:4,error:undefined};output={order};break}
    case 'report_error':{run={...run,status:run.status==='rejected'?'rejected':'error',error:String(body.error||'Agent service lỗi').slice(0,2000)};output={run};break}
   }
   const tokens=body.tokensUsed??0;requireThat(Number.isSafeInteger(tokens)&&tokens>=0&&tokens<=1e7,'tokensUsed không hợp lệ');const usages=run.usageIds||[];const added=body.usageId&&!usages.includes(body.usageId)?tokens:!body.usageId?0:0;
   run={...run,stepCount:run.stepCount+1,tokensUsed:run.tokensUsed+added,usageIds:body.usageId?[...new Set([...usages,body.usageId])]:usages};await repo.put('agent_runs',run);
   await repo.put('agent_steps',entity({runId:run.id,tool:name,stage:run.stage,status:name==='report_error'?'error':'completed',detail:output.proposal||`Thực hiện ${name}`}));await repo.put('audit',entity({actorId:'agent',actorName:'AI Agent',role:'agent',action:`tool:${name}`,entityType:auditEntityType(`tool:${name}`),entityId:run.id}));return output;
  })}catch(error:any){
   await this.db.transaction(async repo=>{repo.setActor({id:'agent',name:'AI Agent',role:'agent'},body.runId);const run=await repo.get('agent_runs',body.runId);if(run)await repo.put('agent_steps',entity({runId:run.id,tool:name,stage:run.stage,status:'denied',detail:error.message}))});throw error;
  }
 }
}
