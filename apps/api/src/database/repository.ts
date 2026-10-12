import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {totalMoney} from '../money';
import {Executor,RecordData,RepositoryActor,Table,tableName,safeNumber,isoTimestamp,calendarDate,fingerprint,canonicalJson} from './contracts';
export {TABLES,Table,RecordData,Executor} from './contracts';

type Kind='text'|'integer'|'number'|'timestamp'|'date'|'json'|'boolean'|'array';
type Field=[string,string,Kind?,any?];
const common:Field[]=[['id','id'],['createdAt','created_at','timestamp'],['updatedAt','updated_at','timestamp']];
const fields:Record<Table,Field[]>={
 users:[['name','name'],['email','email'],['role','role'],['passwordHash','password_hash'],['demo','demo','boolean',false],['active','active','boolean',true]],
 products:[['sku','sku'],['name','name'],['unit','unit'],['minStock','min_stock','integer']],
 suppliers:[['name','name'],['email','email'],['phone','phone','text',''],['reputation','reputation','number'],['active','active','boolean',true]],
 prices:[['productId','product_id'],['supplierId','supplier_id'],['unitPrice','unit_price','integer'],['deliveryDays','delivery_days','integer'],['qualityScore','quality_score','number']],
 requests:[['reason','reason'],['status','status'],['runId','run_id']],
 rfqs:[['requestLineId','request_line_id'],['requestId','request_id'],['productId','product_id'],['status','status'],['runId','run_id']],
 quotations:[['rfqId','rfq_id'],['supplierId','supplier_id'],['quantity','quantity','integer'],['unitPrice','unit_price','integer'],['vat','vat','number',0],['currency','currency','text','VND'],['deliveryDays','delivery_days','integer'],['qualityScore','quality_score','number'],['validUntil','valid_until','date'],['source','source','text','manual']],
 ahp_sessions:[['rfqId','rfq_id'],['status','status'],['cr','cr','number'],['consistent','consistent','boolean'],['runId','run_id']],
 approvals:[['gate','gate','integer'],['requestId','request_id'],['rfqId','rfq_id'],['sessionId','session_id'],['status','status'],['supplierId','selected_supplier_id'],['proposal','proposal'],['comment','comment'],['decidedBy','decided_by'],['decidedAt','decided_at','timestamp'],['runId','run_id']],
 orders:[['supplierId','supplier_id'],['status','status'],['sentAt','sent_at','timestamp'],['runId','run_id']],
 receipts:[['orderId','order_id'],['idempotencyKey','idempotency_key'],['receivedAt','received_at','timestamp'],['notes','notes','text',''],['createdBy','created_by']],
 evaluations:[['orderId','order_id'],['supplierId','supplier_id'],['productId','product_id'],['reportedQualityScore','reported_quality_score','number'],['acceptanceScore','acceptance_score','number'],['qualityScore','quality_score','number'],['deliveryScore','delivery_score','number'],['serviceScore','service_score','number'],['overallScore','overall_score','number'],['notes','notes','text',''],['createdBy','created_by']],
 agent_runs:[['productId','product_id'],['requestId','request_id'],['rfqId','rfq_id'],['sessionId','session_id'],['orderId','order_id'],['status','status'],['stage','stage','integer'],['createdBy','created_by'],['quantity','quantity','integer'],['tokensUsed','tokens_used','integer',0],['stepCount','step_count','integer',0],['demo','demo','boolean',false],['error','error'],['usageIds','usage_ids','array',[]]],
 agent_steps:[['runId','run_id'],['tool','tool'],['stage','stage','integer'],['status','status'],['detail','detail','json']],
 history:[['productId','product_id'],['supplierId','supplier_id'],['month','month','date'],['quantity','quantity','integer'],['unitPrice','unit_price','integer'],['onTime','on_time','boolean'],['qualityScore','quality_score','number'],['synthetic','synthetic','boolean',false]],
 audit:[['actorName','actor_name'],['role','actor_role'],['action','action'],['entityType','entity_type'],['entityId','entity_id'],['detail','detail','json',{}]],
 outbox:[['messageKey','message_key'],['type','type'],['rfqId','rfq_id'],['orderId','order_id'],['supplierId','supplier_id'],['to','recipient'],['subject','subject'],['text','text_body'],['status','status']],
};
const withoutUpdated=new Set<Table>(['receipts','evaluations','history','audit','agent_steps']);
const sessionInput=['criteria','matrix'];
const sessionResult=['weights','lambdaMax','ci','flattenedCriteria','treeConsistency','ranking','monteCarlo','sensitivity'];
const requestLineFields:Field[]=[['id','id'],['createdAt','created_at','timestamp'],['requestId','request_id'],['lineNo','line_no','integer'],['productId','product_id'],['quantity','quantity','integer']];
const candidateFields:Field[]=[['id','quotation_id'],['rfqId','rfq_id'],['supplierId','supplier_id'],['supplierName','supplier_name'],['quantity','quantity','integer'],['unitPrice','unit_price','integer'],['vat','vat','number'],['currency','currency'],['deliveryDays','delivery_days','integer'],['qualityScore','quality_score','number'],['validUntil','valid_until','date'],['source','source'],['createdAt','quotation_created_at','timestamp'],['updatedAt','quotation_updated_at','timestamp'],['criterionInputs','criterion_inputs','json']];
const orderLineFields:Field[]=[...common,['lineNo','line_no','integer'],['rfqId','rfq_id'],['sessionId','session_id'],['productId','product_id'],['productSku','product_sku'],['productName','product_name'],['unit','unit'],['quantity','quantity','integer'],['unitPrice','unit_price','integer'],['vat','vat','number'],['deliveryDays','delivery_days','integer'],['receivedQuantity','received_quantity','integer',0],['acceptedQuantity','accepted_quantity','integer',0]];
const receiptLineFields:Field[]=[['id','id'],['orderLineId','order_line_id'],['productId','product_id'],['quantity','quantity','integer'],['acceptedQuantity','accepted_quantity','integer']];
const selectFields=(list:Field[],alias='t')=>list.map(([,column,kind])=>`${alias}.${column}${['date','number','integer'].includes(kind||'')?'::text':''} AS ${column}`).join(',');
function decode(row:any,list:Field[]):any {
 const out:any={};for(const [key,column,kind] of list){const value=row[column];if(value===null||value===undefined)continue;out[key]=kind==='integer'?safeNumber(value,true):kind==='number'?safeNumber(value):kind==='timestamp'?isoTimestamp(value):kind==='date'?calendarDate(value):value}return out;
}
function encode(data:any,list:Field[]):Record<string,any> {
 const out:Record<string,any>={};for(const [key,column,kind,fallback] of list){let value=data[key]??fallback;if(value===undefined){out[column]=null;continue}
  if(kind==='integer'||kind==='number')value=safeNumber(value,kind==='integer');
  if(kind==='timestamp')value=isoTimestamp(value);
  if(kind==='date')value=calendarDate(key==='month'&&/^\d{4}-\d{2}$/.test(value)?`${value}-01`:value);
  if(kind==='json')value=canonicalJson(value);
  out[column]=value;
 }return out;
}
const pick=(data:any,keys:string[])=>Object.fromEntries(keys.filter(key=>data[key]!==undefined).map(key=>[key,data[key]]));
const immutable=(before:any,after:any,keys:string[],message:string)=>{if(!isDeepStrictEqual(pick(before,keys),pick(after,keys)))throw new Error(message)};
// The schema no longer stores a revision: a session never changes, so the API value is the constant 1.
export interface PageQuery {page:number;pageSize:number;search?:string}
export interface Page<T> {rows:T[];total:number;page:number;pageSize:number}
export interface StockMovement {id:string;productId:string;sku:string;productName:string;unit:string;kind:'OPENING'|'RECEIPT';delta:number;balanceAfter:number;createdAt:string;actorName:string;receiptId?:string;orderId?:string;supplierName?:string}
/** Search text matched literally: the user's % and _ are not wildcards. */
const like=(text:string)=>`%${text.replace(/[\\%_]/g,'\\$&')}%`;
const rfqOpen=(column:string)=>`EXISTS (SELECT 1 FROM procurement.rfqs q WHERE q.id=${column} AND q.status='open')`;
const orderOpen=(alias:string)=>`(${alias}.status<>'received' OR NOT EXISTS (SELECT 1 FROM procurement.evaluations e WHERE e.order_id=${alias}.id))`;
/** What the workspace needs loaded at once: every document someone still has to
 * act on, plus recent ones for context. Finished older documents are reached
 * through the paged lists instead, so this set follows the pace of work and
 * not the size of the history. `since` is a bound parameter. */
const WORKING:Partial<Record<Table,(since:string)=>string>>={
 requests:since=>`(t.created_at>=${since} OR t.status='pending' OR (t.status='approved' AND EXISTS (SELECT 1 FROM procurement.request_lines l LEFT JOIN procurement.rfqs q ON q.request_line_id=l.id WHERE l.request_id=t.id AND (q.id IS NULL OR q.status='open'))))`,
 rfqs:since=>`(t.created_at>=${since} OR t.status='open')`,
 quotations:since=>`(t.created_at>=${since} OR ${rfqOpen('t.rfq_id')})`,
 ahp_sessions:since=>`(t.created_at>=${since} OR ${rfqOpen('t.rfq_id')})`,
 approvals:since=>`(t.created_at>=${since} OR t.status='pending' OR ${rfqOpen('t.rfq_id')})`,
 orders:since=>`(t.created_at>=${since} OR ${orderOpen('t')})`,
 receipts:since=>`(t.created_at>=${since} OR EXISTS (SELECT 1 FROM procurement.orders o WHERE o.id=t.order_id AND ${orderOpen('o')}))`,
 evaluations:since=>`t.created_at>=${since}`,
 outbox:since=>`(t.created_at>=${since} OR t.status='pending')`,
};
export const DOCUMENT_KINDS=['requests','rfqs','quotations','approvals','orders','receipts','evaluations'] as const;
export type DocumentKind=typeof DOCUMENT_KINDS[number];
export interface DocumentQuery extends PageQuery {status?:string;gate?:number;rfqId?:string;orderId?:string}
/** WHERE clause built from fixed SQL fragments and numbered parameters only. */
class Filter {
 values:unknown[]=[];private clauses:string[]=[];
 next(value:unknown){this.values.push(value);return `$${this.values.length}`}
 add(clause:(...parameters:string[])=>string,...values:unknown[]){this.clauses.push(clause(...values.map(value=>this.next(value))))}
 get where(){return this.clauses.length?` WHERE ${this.clauses.join(' AND ')}`:''}
}
/** An aggregate has no upper bound; one too large for an exact JS integer is reported as missing. */
const exactOrNull=(value:unknown):number|null=>{try{return safeNumber(value,true)}catch{return null}};
const singleRevision=(data:any)=>{if(data.revision!==undefined&&data.revision!==1)throw new Error('Only revision 1 exists; a changed AHP input is a new session')};

/** All table/column names originate in these static descriptors. Values are
 * parameters. JSON is restricted to explicit immutable artifacts and details.
 * Stock, PO counters, PO status and ledger rows are written by schema triggers;
 * this class only inserts the documents they derive from. */
export class Repository {
 private actor?:RepositoryActor;private runId?:string;
 constructor(private executor:Executor){}
 setActor(actor:RepositoryActor,runId?:string){this.actor=actor;this.runId=runId}
 private descriptor(table:Table){tableName(table);return [...common.filter(([key])=>key!=='updatedAt'||!withoutUpdated.has(table)),...fields[table]]}
 private async write(table:string,values:Record<string,any>,mode:'upsert'|'insert'='upsert'){
  const keys=Object.keys(values),params=keys.map(key=>values[key]);
  await this.executor.query(`INSERT INTO procurement.${table} (${keys.join(',')}) VALUES (${keys.map((_,i)=>`$${i+1}`).join(',')})${mode==='upsert'?` ON CONFLICT(id) DO UPDATE SET ${keys.filter(k=>k!=='id').map(k=>`${k}=EXCLUDED.${k}`).join(',')}`:''}`,params);
 }
 /** With `since`, only the working set: documents still in progress plus those created from that instant on. */
 async list(table:Table,since?:string):Promise<RecordData[]>{return this.find(table,{},since)}
 async get(table:Table,id:string):Promise<RecordData|undefined>{return (await this.find(table,{id}))[0]}
 async find(table:Table,filters:Record<string,unknown>,since?:string):Promise<RecordData[]> {
  const descriptor=this.descriptor(table),allowed:Record<string,string>={};
  for(const [key,column] of descriptor)allowed[key]=`t.${column}`;
  // Restrict filters to useful scalar keys, never accept artifacts as filters.
  for(const key of Object.keys(allowed))if(!['id','email','sku','role','active','status','productId','supplierId','requestId','requestLineId','rfqId','sessionId','orderId','runId','gate','revision','idempotencyKey','messageKey','entityId','entityType','actorName','createdBy','month'].includes(key))delete allowed[key];
  if(table==='requests')allowed.productId='request_product';
  if(table==='orders'){allowed.rfqId='order_rfq';allowed.sessionId='order_session';allowed.productId='order_product';allowed.requestId='order_request'}
  if(table==='audit')allowed.actorId='t.actor_user_id';
  const values:any[]=[],where:string[]=[];
  for(const [key,value] of Object.entries(filters)){
   if(key==='ids'){values.push(value);where.push(`t.id=ANY($${values.length}::text[])`);continue}
   const expression=allowed[key];if(!expression)throw new Error(`Unknown filter ${table}.${key}`);
   if(value===undefined)throw new Error(`Undefined filter ${table}.${key}`);
   if(value===null){if(expression.startsWith('order_')||expression==='request_product')throw new Error(`NULL is not valid for lineage filter ${table}.${key}`);where.push(`${expression} IS NULL`);continue}
   values.push(table==='history'&&key==='month'&&/^\d{4}-\d{2}$/.test(String(value))?`${value}-01`:value);
   const parameter=`$${values.length}`;
   if(expression==='request_product')where.push(`EXISTS (SELECT 1 FROM procurement.request_lines f WHERE f.request_id=t.id AND f.product_id=${parameter})`);
   else if(expression==='order_request')where.push(`EXISTS (SELECT 1 FROM procurement.order_lines f JOIN procurement.rfqs r ON r.id=f.rfq_id WHERE f.order_id=t.id AND r.request_id=${parameter})`);
   else if(expression.startsWith('order_'))where.push(`EXISTS (SELECT 1 FROM procurement.order_lines f WHERE f.order_id=t.id AND f.${expression.slice(6)}_id=${parameter})`);
   else if(key==='email'&&table==='users')where.push(`lower(${expression})=lower(${parameter})`);
   else where.push(value===null?`${expression} IS NULL`:`${expression}=${parameter}`);
  }
  const working=since?WORKING[table]:undefined;
  if(working){values.push(since);where.push(working(`$${values.length}`))}
  // Extra typed source columns only; dates always cast to text before pg can
  // parse a DATE as local midnight and shift its calendar day.
  const extras=table==='products'?',(SELECT quantity::text FROM procurement.inventory_balances b WHERE b.product_id=t.id) AS stock'
   :table==='requests'?',t.actor_kind,t.created_by_user_id'
   :table==='rfqs'?',(SELECT quantity::text FROM procurement.request_lines l WHERE l.id=t.request_line_id) AS line_quantity'
   :table==='ahp_sessions'?',t.input_artifact,t.result_artifact'
   :table==='receipts'?',t.input_payload,(SELECT supplier_id FROM procurement.orders o WHERE o.id=t.order_id) AS order_supplier_id'
   :table==='audit'?',t.actor_kind,t.actor_user_id':'';
  const {rows}=await this.executor.query(`SELECT ${selectFields(descriptor)}${extras} FROM procurement.${table} t${where.length?` WHERE ${where.join(' AND ')}`:''} ORDER BY t.created_at,t.id`,values);
  // Child rows are fetched once per table, never once per document: a list costs
  // the same number of statements (at most three) however many rows it returns.
  const ids=rows.map(row=>row.id);
  const children=async(sql:string)=>{
   const groups=new Map<string,any[]>();
   if(ids.length)for(const child of (await this.executor.query(sql,[ids])).rows){const group=groups.get(child.parent_id);if(group)group.push(child);else groups.set(child.parent_id,[child])}
   return groups;
  };
  const lines=table==='requests'?await children(`SELECT t.request_id AS parent_id,${selectFields(requestLineFields)} FROM procurement.request_lines t WHERE t.request_id=ANY($1::text[]) ORDER BY t.line_no`)
   :table==='rfqs'?await children('SELECT rfq_id AS parent_id,supplier_id FROM procurement.rfq_suppliers WHERE rfq_id=ANY($1::text[]) ORDER BY created_at,supplier_id')
   :table==='ahp_sessions'?await children(`SELECT t.session_id AS parent_id,${selectFields(candidateFields)} FROM procurement.ahp_candidates t WHERE t.session_id=ANY($1::text[]) ORDER BY t.created_at,t.id`)
   :table==='orders'?await children(`SELECT t.order_id AS parent_id,${selectFields(orderLineFields)},r.request_id FROM procurement.order_lines t JOIN procurement.rfqs r ON r.id=t.rfq_id WHERE t.order_id=ANY($1::text[]) ORDER BY t.line_no`)
   :table==='receipts'?await children(`SELECT t.receipt_id AS parent_id,${selectFields(receiptLineFields)} FROM procurement.receipt_lines t WHERE t.receipt_id=ANY($1::text[]) ORDER BY t.order_line_id`)
   :new Map<string,any[]>();
  // The approved candidate of each PO line, keyed by the line.
  const snapshots=table==='orders'?await children(`SELECT l.id AS parent_id,${selectFields(candidateFields,'c')} FROM procurement.order_lines l JOIN procurement.ahp_candidates c ON c.id=l.candidate_id WHERE l.order_id=ANY($1::text[])`):new Map<string,any[]>();
  const output:RecordData[]=[];
  for(const row of rows){const data=decode(row,descriptor) as RecordData,own=lines.get(data.id)??[];
   if(table==='products')data.stock=safeNumber(row.stock,true);
   if(table==='history')data.month=data.month.slice(0,7);
   if(table==='requests'){
    data.createdBy=row.actor_kind==='agent'?'agent':row.created_by_user_id;
    data.items=own.map(line=>decode(line,requestLineFields));
    this.flat(data,['productId','quantity']);
   }
   if(table==='rfqs'){data.quantity=safeNumber(row.line_quantity,true);data.supplierIds=own.map(line=>line.supplier_id)}
   if(table==='ahp_sessions'){
    Object.assign(data,pick(row.input_artifact,sessionInput),pick(row.result_artifact,sessionResult));data.revision=1;
    const order:string[]=row.input_artifact.quotationOrder??[];
    data.quotationSnapshots=own.map(line=>decode(line,candidateFields)).sort((a:any,b:any)=>order.indexOf(a.id)-order.indexOf(b.id));
   }
   if(table==='orders'){
    data.items=own.map(line=>{const item=decode(line,orderLineFields);item.requestId=line.request_id;item.total=totalMoney(item.quantity,item.unitPrice,item.vat);item.quotationSnapshot=decode(snapshots.get(item.id)![0],candidateFields);return item});
    data.total=safeNumber(data.items.reduce((sum:number,line:any)=>sum+line.total,0),true);
    this.flat(data,['requestId','rfqId','sessionId','productId','quantity','unitPrice','vat','deliveryDays','receivedQuantity','acceptedQuantity','quotationSnapshot']);
   }
   if(table==='receipts'){
    data.input=row.input_payload;data.supplierId=row.order_supplier_id;
    data.items=own.map(line=>decode(line,receiptLineFields));
    this.flat(data,['productId','quantity','acceptedQuantity']);
   }
   if(table==='audit')data.actorId=row.actor_kind==='agent'?'agent':row.actor_user_id;
   if(table==='approvals'&&data.gate===2)data.revision=1;
   output.push(data);
  }return output;
 }
 private flat(data:any,keys:string[]){if(data.items.length===1)for(const key of keys)if(data.items[0][key]!==undefined)data[key]=data.items[0][key]}
 async put(table:Table,data:RecordData):Promise<RecordData>{
  const descriptor=this.descriptor(table),before=await this.get(table,data.id),values=encode(data,descriptor);
  if(table==='products'){
   const stock=safeNumber(data.stock??0,true);if(stock<0)throw new Error('Stock must be nonnegative');
   if(before&&before.stock!==stock)throw new Error('Product stock changes require an inventory movement');
   // Opening stock and its creator are fixed at insert; the trigger posts the OPENING movement.
   if(before)await this.write(table,values);
   else await this.write(table,{...values,opening_stock:stock,created_by_user_id:this.actor&&this.actor.role!=='agent'?this.actor.id:null},'insert');
  }else if(table==='requests'){
   const agent=data.createdBy==='agent'||this.actor?.role==='agent';
   values.actor_kind=agent?'agent':'user';values.created_by_user_id=agent?null:data.createdBy;
   await this.write(table,values);
   await this.requestLines(data,before);
  }else if(table==='rfqs'){
   let lineId=data.requestLineId;
   if(!lineId){const lines=await this.executor.query('SELECT id FROM procurement.request_lines WHERE request_id=$1 ORDER BY line_no',[data.requestId]);if(lines.rows.length!==1)throw new Error('RFQ requires requestLineId for a multi-line request');lineId=lines.rows[0].id}
   const line=(await this.executor.query('SELECT request_id,product_id FROM procurement.request_lines WHERE id=$1',[lineId])).rows[0];if(!line)throw new Error('RFQ request line is missing');
   Object.assign(values,{request_line_id:lineId,request_id:line.request_id,product_id:line.product_id});
   await this.write(table,values);
   const supplierIds=data.supplierIds;if(!Array.isArray(supplierIds)||new Set(supplierIds).size!==supplierIds.length)throw new Error('Invalid RFQ invitations');
   if(before&&!isDeepStrictEqual([...before.supplierIds].sort(),[...supplierIds].sort()))throw new Error('RFQ invitations are immutable');
   for(const [index,sid] of supplierIds.entries())await this.executor.query('INSERT INTO procurement.rfq_suppliers(rfq_id,supplier_id,created_at) VALUES ($1,$2,$3) ON CONFLICT(rfq_id,supplier_id) DO NOTHING',[data.id,sid,new Date(Date.parse(data.createdAt)+index).toISOString()]);
  }else if(table==='ahp_sessions'){
   singleRevision(data);
   if(before){immutable(before,data,['id','createdAt','rfqId','cr','consistent','runId',...sessionInput,...sessionResult,'quotationSnapshots'],'AHP inputs, results and candidates are immutable');await this.executor.query('UPDATE procurement.ahp_sessions SET status=$2,updated_at=$3 WHERE id=$1',[data.id,data.status,data.updatedAt??null])}
   else {values.input_artifact=canonicalJson({...pick(data,sessionInput),quotationOrder:data.quotationSnapshots?.map((q:any)=>q.id)});values.result_artifact=canonicalJson(pick(data,sessionResult));await this.write(table,values,'insert');
    if(!Array.isArray(data.quotationSnapshots)||!data.quotationSnapshots.length)throw new Error('AHP candidates are required');
    for(const q of data.quotationSnapshots){const cv=encode(q,candidateFields);cv.quotation_id=q.id;cv.id=randomUUID();cv.session_id=data.id;cv.rfq_id=data.rfqId;cv.created_at=data.createdAt;await this.write('ahp_candidates',cv,'insert')}
   }
  }else if(table==='orders'){
   if(before)immutable(before,data,['supplierId','createdAt','runId'],'Purchase order terms are immutable');
   if(before)await this.executor.query('UPDATE procurement.orders SET sent_at=$2,updated_at=$3 WHERE id=$1',[data.id,data.sentAt??null,data.updatedAt??null]);else await this.write(table,values,'insert');
   await this.orderLines(data,before);
  }else if(table==='receipts'){
   if(before)throw new Error('Receipt is immutable');
   if(!data.input||typeof data.input!=='object'||Array.isArray(data.input))throw new Error('Receipt input is required');
   // The payload is kept as sent; the fingerprint is taken over its UTC form so one instant has one fingerprint.
   values.input_payload=canonicalJson(data.input);values.request_fingerprint=fingerprint(typeof data.input.receivedAt==='string'?{...data.input,receivedAt:isoTimestamp(data.input.receivedAt)}:data.input);await this.write(table,values,'insert');await this.receiptLines(data);
  }else if(table==='audit'){
   const agent=data.role==='agent';values.actor_kind=agent?'agent':'user';values.actor_user_id=agent?null:data.actorId;await this.write(table,values,'insert');
  }else{if(table==='approvals')singleRevision(data);await this.write(table,values,table==='agent_steps'||table==='evaluations'?'insert':'upsert')}
  return (await this.get(table,data.id))!;
 }
 private async requestLines(data:RecordData,before?:RecordData){
  const items=data.items??[{productId:data.productId,quantity:data.quantity}];if(!Array.isArray(items)||!items.length)throw new Error('Request items are required');
  // Existing one-item callers supply the flat values, so they take precedence.
  const single=items.length===1;
  const lines=items.map((item:any,index:number)=>({lineNo:index+1,productId:single&&data.productId!==undefined?data.productId:item.productId,quantity:single&&data.quantity!==undefined?data.quantity:item.quantity}));
  if(before){if(!isDeepStrictEqual(lines,before.items.map((line:any)=>pick(line,['lineNo','productId','quantity']))))throw new Error('Request lines are immutable');return}
  for(const line of lines)await this.write('request_lines',encode({...line,id:randomUUID(),requestId:data.id,createdAt:data.createdAt},requestLineFields),'insert');
 }
 private async orderLines(data:RecordData,before?:RecordData){
  const items=data.items??[data];if(!Array.isArray(items)||!items.length)throw new Error('Order items are required');
  if(before&&items.length!==before.items.length)throw new Error('Purchase order terms are immutable');
  for(let index=0;index<items.length;index++){
   const old=before?.items.find((x:any)=>x.lineNo===index+1),item={...items[index]};
   if(items.length===1)for(const key of ['requestId','rfqId','sessionId','productId','quantity','unitPrice','vat','deliveryDays','receivedQuantity','acceptedQuantity','quotationSnapshot'])if(data[key]!==undefined)item[key]=data[key];
   if(old){
    immutable(old,item,['rfqId','sessionId','productId','quantity','unitPrice','vat','deliveryDays','quotationSnapshot'],'Purchase order source and financial terms are immutable');
    if((item.receivedQuantity??old.receivedQuantity)!==old.receivedQuantity||(item.acceptedQuantity??old.acceptedQuantity)!==old.acceptedQuantity)throw new Error('Purchase order counters are derived from receipt lines');
    continue;
   }
   const candidate=(await this.executor.query('SELECT id,rfq_id,supplier_id,unit_price::text,vat::text,delivery_days FROM procurement.ahp_candidates WHERE session_id=$1 AND supplier_id=$2',[item.sessionId,data.supplierId])).rows[0];
   if(!candidate)throw new Error('Purchase order candidate is missing');
   const approval=(await this.executor.query("SELECT id FROM procurement.approvals WHERE gate=2 AND session_id=$1 AND selected_supplier_id=$2 AND status='approved'",[item.sessionId,data.supplierId])).rows[0];
   if(!approval)throw new Error('Purchase order has no approved gate 2 decision for this supplier');
   for(const [key,column] of [['unitPrice','unit_price'],['vat','vat'],['deliveryDays','delivery_days']])if(item[key]!==undefined&&item[key]!==safeNumber(candidate[column]))throw new Error('Purchase order terms must match approved candidate');
   Object.assign(item,{id:randomUUID(),lineNo:index+1,createdAt:data.createdAt,unitPrice:safeNumber(candidate.unit_price,true),vat:safeNumber(candidate.vat),deliveryDays:safeNumber(candidate.delivery_days,true)});
   // Counters and the product snapshot in this row are replaced by the insert trigger.
   const row=encode(item,orderLineFields);Object.assign(row,{order_id:data.id,candidate_id:candidate.id,approval_id:approval.id,supplier_id:data.supplierId});await this.write('order_lines',row,'insert');
  }
 }
 private async receiptLines(data:RecordData){
  const order=await this.get('orders',data.orderId);if(!order)throw new Error('Receipt order is missing');
  const items=data.items??(order.items.length===1?[{...data,orderLineId:order.items[0].id}]:undefined);
  if(!Array.isArray(items)||!items.length)throw new Error('Receipt requires items for a multi-line order');
  const rows=items.map((item:any)=>{const line=order.items.find((x:any)=>x.id===item.orderLineId);if(!line)throw new Error('Receipt order line is missing');return {...item,id:randomUUID(),productId:line.productId}});
  // Each insert posts stock through a trigger; one global product order keeps
  // two multi-line receipts from locking balances in opposite directions.
  rows.sort((a:any,b:any)=>a.productId<b.productId?-1:a.productId>b.productId?1:a.orderLineId<b.orderLineId?-1:1);
  for(const item of rows){const row=encode(item,receiptLineFields);Object.assign(row,{receipt_id:data.id,order_id:data.orderId,created_at:data.createdAt});await this.write('receipt_lines',row,'insert')}
 }
 async remove(table:Table,id:string){tableName(table);await this.executor.query(`DELETE FROM procurement.${table} WHERE id=$1`,[id])}
 async lock(table:Table,id:string,mode:'update'|'share'='update'){tableName(table);if(!['update','share'].includes(mode))throw new Error('Unknown lock mode');await this.executor.query(`SELECT id FROM procurement.${table} WHERE id=$1 FOR ${mode==='share'?'SHARE':'UPDATE'}`,[id]);return this.get(table,id)}
 async lockRfq(id:string){return this.lock('rfqs',id)}
 async lockOrder(id:string){const order=await this.lock('orders',id);await this.executor.query('SELECT id FROM procurement.order_lines WHERE order_id=$1 ORDER BY id FOR UPDATE',[id]);return order}
 async dashboardSummary(){
  const row=(await this.executor.query(`SELECT
   (SELECT count(*) FROM procurement.products)::text total_products,
   (SELECT count(*) FROM procurement.suppliers WHERE active)::text total_suppliers,
   (SELECT count(*) FROM procurement.approvals WHERE status='pending')::text pending_approvals,
   (SELECT count(*) FROM procurement.orders WHERE status<>'received')::text active_orders,
   (SELECT COALESCE(sum(b.quantity * COALESCE(p.unit_price,0)),0) FROM procurement.inventory_balances b
     LEFT JOIN (SELECT product_id,min(unit_price) unit_price FROM procurement.prices GROUP BY product_id) p USING(product_id))::text inventory_value`)).rows[0];
  return {totalProducts:safeNumber(row.total_products,true),totalSuppliers:safeNumber(row.total_suppliers,true),pendingApprovals:safeNumber(row.pending_approvals,true),activeOrders:safeNumber(row.active_orders,true),inventoryValue:exactOrNull(row.inventory_value)};
 }
 /** Last twelve months. History rows carry no VAT and PO lines include it, so
  * both parts are returned next to their sum. PO months follow `timezone`. */
 async monthlySpend(timezone:string){
  const {rows}=await this.executor.query(`SELECT month,sum(history)::text history,sum(orders)::text orders FROM (
   SELECT to_char(month,'YYYY-MM') AS month,quantity*unit_price AS history,0::numeric AS orders FROM procurement.history
   UNION ALL SELECT to_char(o.created_at AT TIME ZONE $1,'YYYY-MM'),0,round(l.quantity::numeric*l.unit_price*(100+l.vat)/100,0)
   FROM procurement.orders o JOIN procurement.order_lines l ON l.order_id=o.id
  ) sources GROUP BY month ORDER BY month DESC LIMIT 12`,[timezone]);
  return rows.reverse().map(row=>{
   const historyValue=exactOrNull(row.history),orderValue=exactOrNull(row.orders);
   const value=historyValue===null||orderValue===null||!Number.isSafeInteger(historyValue+orderValue)?null:historyValue+orderValue;
   return {month:row.month as string,value,historyValue,orderValue};
  });
 }
 /** One page of a document list, newest first, with search and filters in SQL.
  * Rows have the same shape as everywhere else, plus what a list needs to show
  * a document on its own when the rest of its chain is not loaded. */
 async documentPage(kind:DocumentKind,q:DocumentQuery):Promise<Page<RecordData>> {
  if(!DOCUMENT_KINDS.includes(kind))throw new Error(`Unknown document list: ${kind}`);
  const filter=new Filter(),named=(table:string,key:string)=>(n:string)=>`EXISTS (SELECT 1 FROM procurement.${table} x WHERE x.id=${key} AND x.name ILIKE ${n})`;
  const text=q.search?like(q.search):undefined;
  if(q.status&&kind!=='quotations'&&kind!=='receipts'&&kind!=='evaluations'){if(kind==='approvals'&&q.status==='decided')filter.add(()=>`t.status<>'pending'`);else filter.add(n=>`t.status=${n}`,q.status)}
  if(q.gate&&kind==='approvals')filter.add(n=>`t.gate=${n}`,q.gate);
  if(q.rfqId&&(kind==='quotations'||kind==='approvals'))filter.add(n=>`t.rfq_id=${n}`,q.rfqId);
  if(q.orderId&&(kind==='receipts'||kind==='evaluations'))filter.add(n=>`t.order_id=${n}`,q.orderId);
  if(text){
   const product=(n:string)=>`(p.name ILIKE ${n} OR p.sku ILIKE ${n})`;
   if(kind==='requests')filter.add(n=>`(t.id ILIKE ${n} OR t.reason ILIKE ${n} OR EXISTS (SELECT 1 FROM procurement.request_lines l JOIN procurement.products p ON p.id=l.product_id WHERE l.request_id=t.id AND ${product(n)}))`,text);
   if(kind==='rfqs')filter.add(n=>`(t.id ILIKE ${n} OR EXISTS (SELECT 1 FROM procurement.products p WHERE p.id=t.product_id AND ${product(n)}))`,text);
   if(kind==='quotations')filter.add(n=>`(t.rfq_id ILIKE ${n} OR t.source ILIKE ${n} OR ${named('suppliers','t.supplier_id')(n)})`,text);
   if(kind==='approvals')filter.add(n=>`(t.id ILIKE ${n} OR t.request_id ILIKE ${n} OR t.proposal ILIKE ${n} OR t.comment ILIKE ${n})`,text);
   if(kind==='orders')filter.add(n=>`(t.id ILIKE ${n} OR ${named('suppliers','t.supplier_id')(n)} OR EXISTS (SELECT 1 FROM procurement.order_lines l WHERE l.order_id=t.id AND (l.product_name ILIKE ${n} OR l.product_sku ILIKE ${n})))`,text);
   if(kind==='receipts')filter.add(n=>`(t.id ILIKE ${n} OR t.order_id ILIKE ${n} OR t.notes ILIKE ${n} OR EXISTS (SELECT 1 FROM procurement.orders o JOIN procurement.suppliers x ON x.id=o.supplier_id WHERE o.id=t.order_id AND x.name ILIKE ${n}))`,text);
   if(kind==='evaluations')filter.add(n=>`(t.order_id ILIKE ${n} OR t.notes ILIKE ${n} OR ${named('suppliers','t.supplier_id')(n)})`,text);
  }
  const total=safeNumber((await this.executor.query(`SELECT count(*)::text count FROM procurement.${kind} t${filter.where}`,filter.values)).rows[0].count,true);
  const ids:string[]=(await this.executor.query(`SELECT t.id FROM procurement.${kind} t${filter.where} ORDER BY t.created_at DESC,t.id DESC LIMIT ${filter.next(q.pageSize)} OFFSET ${filter.next((q.page-1)*q.pageSize)}`,filter.values)).rows.map(row=>row.id);
  const found=new Map((ids.length?await this.find(kind,{ids}):[]).map(row=>[row.id,row])),rows=ids.map(id=>found.get(id)!);
  await this.describe(kind,rows);
  return {rows,total,page:q.page,pageSize:q.pageSize};
 }
 /** Adds, in a fixed number of statements, the few facts a list row cannot get from the loaded workspace. */
 private async describe(kind:DocumentKind,rows:RecordData[]){
  if(!rows.length)return;
  const ids=rows.map(row=>row.id),many=async(sql:string,values:unknown[])=>(await this.executor.query(sql,values)).rows;
  if(kind==='rfqs'){
   const counts=new Map((await many('SELECT rfq_id,count(*)::int count FROM procurement.quotations WHERE rfq_id=ANY($1::text[]) GROUP BY rfq_id',[ids])).map(row=>[row.rfq_id,row.count]));
   for(const row of rows)row.quotationCount=counts.get(row.id)??0;
  }
  if(kind==='orders'){
   const evaluated=new Set((await many('SELECT order_id FROM procurement.evaluations WHERE order_id=ANY($1::text[])',[ids])).map(row=>row.order_id));
   for(const row of rows)row.evaluated=evaluated.has(row.id);
  }
  if(kind==='receipts'){
   const lines=new Map((await many('SELECT id,product_name,product_sku,unit FROM procurement.order_lines WHERE order_id=ANY($1::text[])',[rows.map(row=>row.orderId)])).map(row=>[row.id,row]));
   for(const row of rows)for(const item of row.items){const line=lines.get(item.orderLineId);Object.assign(item,{productName:line?.product_name,productSku:line?.product_sku,unit:line?.unit})}
  }
  if(kind==='approvals'){
   // Gate 1 decides every line of its request; gate 2 decides the one product of its RFQ.
   const requestLines=await many('SELECT l.request_id,l.product_id,l.quantity::text FROM procurement.request_lines l WHERE l.request_id=ANY($1::text[]) ORDER BY l.line_no',[rows.map(row=>row.requestId)]);
   const rfqLines=new Map((await many('SELECT q.id,q.product_id,l.quantity::text FROM procurement.rfqs q JOIN procurement.request_lines l ON l.id=q.request_line_id WHERE q.id=ANY($1::text[])',[rows.map(row=>row.rfqId).filter(Boolean)])).map(row=>[row.id,row]));
   const reasons=new Map((await many('SELECT id,reason FROM procurement.requests WHERE id=ANY($1::text[])',[rows.map(row=>row.requestId)])).map(row=>[row.id,row.reason]));
   const people=new Map((await many('SELECT id,name FROM procurement.users WHERE id=ANY($1::text[])',[rows.map(row=>row.decidedBy).filter(Boolean)])).map(row=>[row.id,row.name]));
   const line=(row:any)=>({productId:row.product_id,quantity:safeNumber(row.quantity,true)});
   for(const row of rows){
    row.lines=row.gate===2&&rfqLines.has(row.rfqId)?[line(rfqLines.get(row.rfqId))]:requestLines.filter(candidate=>candidate.request_id===row.requestId).map(line);
    row.reason=reasons.get(row.requestId);if(row.decidedBy)row.decidedByName=people.get(row.decidedBy);
   }
  }
 }
 /** One page of the audit log, newest first. Filters and paging run in SQL, so
  * the cost does not grow with the size of the log. `from`/`to` are calendar
  * days in `timezone`, both inclusive. */
 async auditPage(q:PageQuery&{action?:string;entityType?:string;from?:string;to?:string;timezone:string}):Promise<Page<RecordData>> {
  const filter=new Filter();
  if(q.search)filter.add(n=>`(a.actor_name ILIKE ${n} OR a.action ILIKE ${n} OR a.entity_type ILIKE ${n} OR a.entity_id ILIKE ${n})`,like(q.search));
  if(q.action)filter.add(n=>`a.action=${n}`,q.action);
  if(q.entityType)filter.add(n=>`a.entity_type=${n}`,q.entityType);
  if(q.from)filter.add((day,zone)=>`a.created_at>=(${day}::date::timestamp AT TIME ZONE ${zone})`,q.from,q.timezone);
  if(q.to)filter.add((day,zone)=>`a.created_at<((${day}::date+1)::timestamp AT TIME ZONE ${zone})`,q.to,q.timezone);
  const total=safeNumber((await this.executor.query(`SELECT count(*)::text count FROM procurement.audit a${filter.where}`,filter.values)).rows[0].count,true);
  const {rows}=await this.executor.query(`SELECT a.id,a.created_at,a.actor_kind,a.actor_user_id,a.actor_name,a.actor_role,a.action,a.entity_type,a.entity_id,a.detail FROM procurement.audit a${filter.where} ORDER BY a.created_at DESC,a.id DESC LIMIT ${filter.next(q.pageSize)} OFFSET ${filter.next((q.page-1)*q.pageSize)}`,filter.values);
  return {total,page:q.page,pageSize:q.pageSize,rows:rows.map(row=>({id:row.id,createdAt:isoTimestamp(row.created_at),actorId:row.actor_kind==='agent'?'agent':row.actor_user_id,actorName:row.actor_name,role:row.actor_role,action:row.action,...(row.entity_type?{entityType:row.entity_type}:{}),...(row.entity_id?{entityId:row.entity_id}:{}),detail:row.detail}))};
 }
 /** One page of the stock ledger, newest first, each row with the balance it
  * left behind and the document and person behind it. The running balance is
  * computed over the whole ledger before any filter is applied. */
 async movementPage(q:PageQuery&{productId?:string;kind?:string}):Promise<Page<StockMovement>> {
  const filter=new Filter();
  if(q.search)filter.add(n=>`(product_name ILIKE ${n} OR sku ILIKE ${n} OR supplier_name ILIKE ${n} OR actor_name ILIKE ${n})`,like(q.search));
  if(q.productId)filter.add(n=>`product_id=${n}`,q.productId);
  if(q.kind)filter.add(n=>`kind=${n}`,q.kind);
  const ledger=`(SELECT m.id,m.product_id,p.sku,p.name AS product_name,p.unit,m.kind,m.delta::text,m.created_at,
     sum(m.delta) OVER (PARTITION BY m.product_id ORDER BY m.created_at,m.id)::text AS balance_after,
     COALESCE(u.name,'Hệ thống') AS actor_name,rc.id AS receipt_id,rc.order_id,s.name AS supplier_name
    FROM procurement.inventory_movements m JOIN procurement.products p ON p.id=m.product_id
    LEFT JOIN procurement.users u ON u.id=m.created_by_user_id
    LEFT JOIN procurement.receipt_lines rl ON rl.id=m.receipt_line_id
    LEFT JOIN procurement.receipts rc ON rc.id=rl.receipt_id
    LEFT JOIN procurement.orders o ON o.id=rc.order_id
    LEFT JOIN procurement.suppliers s ON s.id=o.supplier_id) ledger`;
  const total=safeNumber((await this.executor.query(`SELECT count(*)::text count FROM ${ledger}${filter.where}`,filter.values)).rows[0].count,true);
  const {rows}=await this.executor.query(`SELECT * FROM ${ledger}${filter.where} ORDER BY created_at DESC,id DESC LIMIT ${filter.next(q.pageSize)} OFFSET ${filter.next((q.page-1)*q.pageSize)}`,filter.values);
  return {total,page:q.page,pageSize:q.pageSize,rows:rows.map(row=>({id:row.id,productId:row.product_id,sku:row.sku,productName:row.product_name,unit:row.unit,kind:row.kind,delta:safeNumber(row.delta,true),balanceAfter:safeNumber(row.balance_after,true),createdAt:isoTimestamp(row.created_at),actorName:row.actor_name,...(row.receipt_id?{receiptId:row.receipt_id,orderId:row.order_id,supplierName:row.supplier_name}:{})}))};
 }
 /** The newest ledger rows in one list, for reports. */
 async inventoryMovements(limit=500){return (await this.movementPage({page:1,pageSize:limit})).rows}
 async inventoryForecast(){
  const {rows}=await this.executor.query(`WITH recent AS (
   SELECT product_id,quantity,row_number() OVER (PARTITION BY product_id ORDER BY month DESC,created_at,id) AS position FROM procurement.history
  ), forecasts AS (SELECT product_id,ceil(avg(quantity)) quantity FROM recent WHERE position<=3 GROUP BY product_id)
  SELECT p.id,p.sku,p.name,p.unit,b.quantity::text stock,p.min_stock::text,
    COALESCE(f.quantity,p.min_stock)::text forecast,
    greatest(0,greatest(COALESCE(f.quantity,p.min_stock),p.min_stock)-b.quantity)::text reorder_quantity
  FROM procurement.products p JOIN procurement.inventory_balances b ON b.product_id=p.id
  LEFT JOIN forecasts f ON f.product_id=p.id ORDER BY p.created_at,p.id`);
  return rows.map(row=>({productId:row.id,sku:row.sku,name:row.name,unit:row.unit,stock:safeNumber(row.stock,true),minStock:safeNumber(row.min_stock,true),forecast:safeNumber(row.forecast,true),reorderQuantity:safeNumber(row.reorder_quantity,true)}));
 }
 async supplierPerformance(){
  const {rows}=await this.executor.query(`SELECT s.id,s.name,
   COALESCE(e.score,h.score,s.reputation)::text score FROM procurement.suppliers s
   LEFT JOIN (SELECT supplier_id,avg(overall_score) score FROM procurement.evaluations GROUP BY supplier_id) e ON e.supplier_id=s.id
   LEFT JOIN (SELECT supplier_id,avg(.6*quality_score+.4*(CASE WHEN on_time THEN 100 ELSE 60 END)) score FROM procurement.history GROUP BY supplier_id) h ON h.supplier_id=s.id
   ORDER BY s.created_at,s.id`);
  return rows.map(row=>({supplierId:row.id,name:row.name,score:safeNumber(row.score)}));
 }
}
