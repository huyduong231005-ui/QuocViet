import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Database} from '../src/db';
import {Procurement} from '../src/procurement';

const buyer={id:'u-buyer',name:'Buyer',role:'buyer'},manager={id:'u-manager',name:'Manager',role:'manager'},receiver=buyer;
const matrix=[[1,2,4,4],[.5,1,2,2],[.25,.5,1,1],[.25,.5,1,1]];
const approvalOf=async(s:Procurement,requestId:string)=>(await s.bootstrap()).approvals.find((a:any)=>a.requestId===requestId&&a.gate===1);

/** A request for paper (ram) and toner (hộp), each line taken through its own
 * RFQ and AHP session to an approved choice of `supplierId`. */
async function approvedLines(s:Procurement,suppliers:Record<string,string>={paper:'sup-anphat',toner:'sup-anphat'}){
 const request=await s.act('request',buyer,{reason:'Giấy và mực cho quý 4',items:[{productId:'pro-paper',quantity:100},{productId:'pro-toner',quantity:8}]});
 await s.act('decide',manager,{approved:true},(await approvalOf(s,request.id)).id);
 const sessions:Record<string,any>={};
 for(const line of request.items){
  const key=line.productId==='pro-paper'?'paper':'toner';
  const rfq=await s.act('rfq',buyer,{requestLineId:line.id,supplierIds:['sup-anphat','sup-minhchau']});
  for(const [supplierId,unitPrice,deliveryDays] of [['sup-anphat',key==='paper'?70000:300000,3],['sup-minhchau',key==='paper'?72000:290000,2]] as const)
   await s.act('quotation',buyer,{rfqId:rfq.id,supplierId,quantity:line.quantity,unitPrice,deliveryDays,qualityScore:90,vat:key==='paper'?8:10,currency:'VND',validUntil:'2099-12-31'});
  const session=await s.act('ahp',buyer,{rfqId:rfq.id,matrix,iterations:100});
  await s.act('decide',manager,{approved:true,supplierId:suppliers[key],comment:'Chọn theo đề xuất'},(await s.act('approval2',buyer,{},session.id)).id);
  sessions[key]=session;
 }
 return {request,sessions};
}
async function workspace(run:(s:Procurement)=>Promise<void>){const db=await Database.open(':memory:');try{const s=new Procurement(db);await s.initialize();await run(s)}finally{await db.close()}}

test('a request holds several products under one gate-1 decision, and each line gets its own RFQ',()=>workspace(async s=>{
 await assert.rejects(()=>s.act('request',buyer,{reason:'Trùng',items:[{productId:'pro-paper',quantity:1},{productId:'pro-paper',quantity:2}]}),/một lần/);
 await assert.rejects(()=>s.act('request',buyer,{reason:'Rỗng',items:[]}),/Danh sách dòng: cần ít nhất 1 mục/);
 await assert.rejects(()=>s.act('request',buyer,{reason:'Sai',items:[{productId:'pro-paper',quantity:0}]}),/Dòng 1 · Số lượng: phải lớn hơn 0/);
 await assert.rejects(()=>s.act('request',buyer,{}),/Lý do: chưa nhập; Dòng 1 · Mặt hàng: chưa nhập; Dòng 1 · Số lượng: chưa nhập/);
 const request=await s.act('request',buyer,{reason:'Hai mặt hàng',items:[{productId:'pro-paper',quantity:100},{productId:'pro-toner',quantity:8}]});
 assert.equal(request.items.length,2);assert.equal(request.productId,undefined);
 const gate=await approvalOf(s,request.id);
 assert.match(gate.proposal,/2 mặt hàng \(Giấy A4 Double A 80gsm: 100 ram; Mực in HP 12A: 8 hộp\)/);
 await assert.rejects(()=>s.act('rfq',buyer,{requestLineId:request.items[0].id,supplierIds:['sup-anphat','sup-minhchau']}),/duyệt/);
 await s.act('decide',manager,{approved:true},gate.id);
 await assert.rejects(()=>s.act('rfq',buyer,{requestId:request.id,supplierIds:['sup-anphat','sup-minhchau']}),/chọn dòng/);
 await assert.rejects(()=>s.act('rfq',buyer,{requestLineId:'missing',supplierIds:['sup-anphat','sup-minhchau']}),(error:any)=>error.statusCode===404);
 const paper=await s.act('rfq',buyer,{requestLineId:request.items[0].id,supplierIds:['sup-anphat','sup-minhchau']});
 const toner=await s.act('rfq',buyer,{requestLineId:request.items[1].id,supplierIds:['sup-anphat','sup-thienlong']});
 assert.deepEqual([paper.productId,paper.quantity,toner.productId,toner.quantity],['pro-paper',100,'pro-toner',8]);
 assert.equal((await s.act('rfq',buyer,{requestLineId:request.items[0].id,supplierIds:['sup-anphat','sup-minhchau']})).id,paper.id);
 // The single-product body still works and still needs no line.
 const single=await s.act('request',buyer,{productId:'pro-pen',quantity:5,reason:'Một mặt hàng'});
 assert.deepEqual([single.productId,single.quantity,single.items.length],['pro-pen',5,1]);
}));

test('one PO groups approved lines of one supplier; receipts post each line by its own unit',()=>workspace(async s=>{
 const {sessions}=await approvedLines(s);
 const po=await s.act('order',buyer,{sessionIds:[sessions.paper.id,sessions.toner.id]});
 assert.equal(po.items.length,2);assert.equal(po.supplierId,'sup-anphat');assert.equal(po.quantity,undefined);
 // 100 x 70,000 + 8% and 8 x 300,000 + 10%, each rounded on its own line.
 assert.deepEqual(po.items.map((line:any)=>[line.productName,line.unit,line.quantity,line.total]),[['Giấy A4 Double A 80gsm','ram',100,7560000],['Mực in HP 12A','hộp',8,2640000]]);
 assert.equal(po.total,10200000);
 assert.equal((await s.act('order',buyer,{sessionIds:[sessions.toner.id,sessions.paper.id]})).id,po.id);
 await assert.rejects(()=>s.act('order',buyer,{sessionId:sessions.paper.id}),/PO/);
 const mail=await s.act('send',buyer,{},po.id);
 assert.match(mail.text,/2 dòng[\s\S]*Giấy A4 Double A 80gsm \(VP-A4-80\): 100 ram[\s\S]*Mực in HP 12A \(VP-TN-12A\): 8 hộp/);

 const [paper,toner]=po.items,at=new Date().toISOString();
 const receipt=(key:string,items:any[])=>({orderId:po.id,receivedAt:at,idempotencyKey:key,notes:'',items});
 await assert.rejects(()=>s.act('receipt',receiver,{orderId:po.id,quantity:1,acceptedQuantity:1,receivedAt:at,idempotencyKey:'flat'}),/từng dòng/);
 await assert.rejects(()=>s.act('receipt',receiver,receipt('dup',[{orderLineId:paper.id,quantity:1,acceptedQuantity:1},{orderLineId:paper.id,quantity:1,acceptedQuantity:1}])),/một lần/);
 await assert.rejects(()=>s.act('receipt',receiver,receipt('foreign',[{orderLineId:'another-line',quantity:1,acceptedQuantity:1}])),/không thuộc PO/);
 await assert.rejects(()=>s.act('receipt',receiver,receipt('over',[{orderLineId:paper.id,quantity:40,acceptedQuantity:40},{orderLineId:toner.id,quantity:9,acceptedQuantity:9}])),/vượt số lượng PO: Mực in/);
 const first=receipt('batch-1',[{orderLineId:paper.id,quantity:40,acceptedQuantity:38},{orderLineId:toner.id,quantity:8,acceptedQuantity:7}]);
 const saved=await s.act('receipt',receiver,first);
 assert.equal(saved.items.length,2);
 // The same lines sent in the other order are the same request.
 assert.equal((await s.act('receipt',receiver,{...first,items:[...first.items].reverse()})).id,saved.id);
 await assert.rejects(()=>s.act('receipt',receiver,{...first,items:[first.items[0]]}),/idempotency/);
 let state=await s.bootstrap();
 assert.deepEqual([state.products.find((p:any)=>p.id==='pro-paper').stock,state.products.find((p:any)=>p.id==='pro-toner').stock],[158,25]);
 assert.equal(state.orders.find((o:any)=>o.id===po.id).status,'partially_received');
 await assert.rejects(()=>s.act('evaluation',buyer,{orderId:po.id,qualityScore:90,serviceScore:90}),/nhận đủ/);
 // Only the paper line is still open; a later receipt may cover just that line.
 await s.act('receipt',receiver,receipt('batch-2',[{orderLineId:paper.id,quantity:60,acceptedQuantity:60}]));
 state=await s.bootstrap();
 const order=state.orders.find((o:any)=>o.id===po.id);
 assert.equal(order.status,'received');
 assert.deepEqual(order.items.map((line:any)=>[line.receivedQuantity,line.acceptedQuantity]),[[100,98],[8,7]]);
 assert.equal(state.movements.filter((m:any)=>m.orderId===po.id).length,3);

 // Acceptance weighs each line by ordered value before VAT:
 // (98 x 70,000 + 7 x 300,000) / (100 x 70,000 + 8 x 300,000) = 8,960,000 / 9,400,000.
 const evaluation=await s.act('evaluation',buyer,{orderId:po.id,qualityScore:90,serviceScore:80});
 assert.ok(Math.abs(evaluation.acceptanceScore-896/9.4)<1e-9);
 assert.equal(evaluation.deliveryScore,100);assert.equal(evaluation.productId,undefined);
 assert.ok(Math.abs(evaluation.overallScore-(.5*(90+896/9.4)/2+.3*100+.2*80))<1e-9);
 assert.equal(state.rfqs.filter((rfq:any)=>rfq.status==='closed').length,2);
}));

test('lines that chose different suppliers cannot share a PO, and a failed line leaves nothing behind',()=>workspace(async s=>{
 const {sessions}=await approvedLines(s,{paper:'sup-anphat',toner:'sup-minhchau'});
 await assert.rejects(()=>s.act('order',buyer,{sessionIds:[sessions.paper.id,sessions.toner.id]}),/cùng chọn một nhà cung cấp/);
 await assert.rejects(()=>s.act('order',buyer,{sessionIds:[sessions.paper.id,sessions.paper.id]}),/lặp/);
 await assert.rejects(()=>s.act('order',buyer,{sessionIds:[sessions.paper.id,'missing']}),(error:any)=>error.statusCode===404);
 assert.equal((await s.bootstrap()).orders.length,0);
 const paper=await s.act('order',buyer,{sessionId:sessions.paper.id}),toner=await s.act('order',buyer,{sessionIds:[sessions.toner.id]});
 assert.deepEqual([paper.supplierId,paper.productId,toner.supplierId,toner.productId],['sup-anphat','pro-paper','sup-minhchau','pro-toner']);
 // A one-line PO still takes the flat receipt and the one-line evaluation formula.
 const receipt=await s.act('receipt',receiver,{orderId:toner.id,quantity:8,acceptedQuantity:7,receivedAt:new Date().toISOString(),idempotencyKey:'flat-toner'});
 assert.deepEqual([receipt.quantity,receipt.acceptedQuantity,receipt.productId],[8,7,'pro-toner']);
 const evaluation=await s.act('evaluation',buyer,{orderId:toner.id,qualityScore:90,serviceScore:80});
 assert.equal(evaluation.acceptanceScore,7/8*100);assert.equal(evaluation.productId,'pro-toner');
}));
