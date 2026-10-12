import {isDeepStrictEqual} from 'node:util';
import {Executor,RecordData,Table,TABLES,isoTimestamp,auditEntityType} from './contracts';
import {Repository} from './repository';

export type LegacyRecords=Record<Table,RecordData[]>;
export async function captureLegacy(executor:Executor):Promise<LegacyRecords>{
 const records={} as LegacyRecords;
 for(const table of TABLES){
  const rows=(await executor.query(`SELECT id,data FROM public.${table} ORDER BY data->>'createdAt',id`)).rows;
  records[table]=rows.map(({id,data})=>{
   if(!data||typeof data!=='object'||Array.isArray(data)||data.id!==id||typeof data.createdAt!=='string')throw new Error(`Malformed legacy ${table} record ${id}`);
   return data;
  });
 }return records;
}
/** Import parents before children; restore Agent forward references after its
 * circular document chain is complete. Old documents take the same path as new
 * ones: a PO starts with zero counters and its receipts rebuild counters, status
 * and ledger through the schema triggers. Opening stock is what remains of the
 * old stock once those receipts are taken out, so nothing is counted twice. */
export async function importLegacy(executor:Executor,records:LegacyRecords){
 validateAgentBindings(records);
 validateBusinessChains(records);
 const repository=new Repository(executor);
 const write=async(table:Table,data:RecordData)=>{
  try{await repository.put(table,data)}catch{throw new Error(`Legacy import failed at ${table} record ${data.id}; invalid types, relationships or constraints`)}
 };
 const received=new Map<string,number>();
 for(const receipt of records.receipts)received.set(receipt.productId,(received.get(receipt.productId)??0)+receipt.acceptedQuantity);
 for(const data of records.users)await write('users',data);
 for(const data of records.products){
  const opening=data.stock-(received.get(data.id)??0);
  if(!Number.isSafeInteger(opening)||opening<0)throw new Error(`Legacy stock is below its accepted receipts: products record ${data.id}`);
  await write('products',{...data,stock:opening});
 }
 for(const table of ['suppliers','prices'] as const)for(const data of records[table])await write(table,data);
 const bindings=['requestId','rfqId','sessionId','orderId'];
 for(const data of records.agent_runs){const base={...data};for(const key of bindings)delete base[key];await write('agent_runs',base)}
 for(const table of ['requests','rfqs','quotations','ahp_sessions','approvals','orders','receipts','evaluations','history','outbox','agent_steps'] as const)for(const data of records[table])await write(table,data);
 // The old service never recorded what kind of entity an audit row pointed at.
 for(const data of records.audit)await write('audit',data.entityId&&!data.entityType?{...data,entityType:auditEntityType(data.action)}:data);
 for(const data of records.agent_runs)await write('agent_runs',data);
 // Verify every original API field before retaining the old tables. Unsupported
 // data is an atomic failure rather than a silently dropped field. Stock, PO
 // counters and PO status are compared here too: they were just rebuilt from
 // the receipts, so a mismatch means the old records contradict each other.
 const ordered=new Set(records.orders.map(order=>order.rfqId));
 for(const table of TABLES){
  const migrated=await repository.list(table);
  if(migrated.length!==records[table].length)throw new Error(`Legacy count mismatch: ${table}`);
  const byId=new Map(migrated.map(data=>[data.id,data]));
  for(const original of records[table]){
   const actual=byId.get(original.id);if(!actual)throw new Error(`Legacy ID mismatch: ${table} record ${original.id}`);
   for(const [key,value] of Object.entries(original)){
    if(value===undefined)continue;
    // The old service left every RFQ open; one with a PO is now closed.
    if(table==='rfqs'&&key==='status'&&ordered.has(original.id)&&actual.status==='closed')continue;
    const expected=['createdAt','updatedAt','sentAt','decidedAt','receivedAt'].includes(key)&&value!==null?isoTimestamp(value):value;
    if(!isDeepStrictEqual(actual[key],expected))throw new Error(`Legacy value mismatch: ${table} record ${original.id} field ${key}`);
   }
  }
 }
 for(const [name,sql] of Object.entries(RECONCILIATION)){
  if((await executor.query(sql)).rows.length)throw new Error(`Legacy reconciliation failed: ${name}`);
 }
}

/** Each query returns the offending rows; all must be empty for any database,
 * migrated or not. */
export const RECONCILIATION:Record<string,string>={
 'balance equals ledger':`SELECT b.product_id FROM procurement.inventory_balances b LEFT JOIN procurement.inventory_movements m USING(product_id) GROUP BY b.product_id,b.quantity HAVING b.quantity<>COALESCE(sum(m.delta),0)`,
 'PO counters equal receipt lines':`SELECT l.id FROM procurement.order_lines l LEFT JOIN procurement.receipt_lines r ON r.order_line_id=l.id GROUP BY l.id,l.received_quantity,l.accepted_quantity HAVING l.received_quantity<>COALESCE(sum(r.quantity),0) OR l.accepted_quantity<>COALESCE(sum(r.accepted_quantity),0)`,
 'PO status follows counters':`SELECT o.id FROM procurement.orders o JOIN procurement.order_lines l ON l.order_id=o.id GROUP BY o.id,o.status HAVING o.status<>CASE WHEN sum(l.received_quantity)=0 THEN 'ordered' WHEN bool_and(l.received_quantity=l.quantity) THEN 'received' ELSE 'partially_received' END`,
 'accepted receipt lines are posted once':`SELECT r.id FROM procurement.receipt_lines r FULL JOIN procurement.inventory_movements m ON m.receipt_line_id=r.id WHERE (m.kind='RECEIPT' AND r.id IS NULL) OR (r.accepted_quantity>0 AND m.id IS NULL) OR (r.accepted_quantity=0 AND m.id IS NOT NULL)`,
 'RFQ is closed exactly when ordered':`SELECT q.id FROM procurement.rfqs q LEFT JOIN procurement.order_lines l ON l.rfq_id=q.id WHERE (q.status='closed')<>(l.id IS NOT NULL)`,
};

function validateAgentBindings(records:LegacyRecords){
 const runs=new Map(records.agent_runs.map(data=>[data.id,data]));
 const byId=(table:Table,id:string)=>records[table].find(data=>data.id===id);
 const fail=(id:string)=>{throw new Error(`Malformed Agent binding chain for run ${id}`)};
 for(const run of records.agent_runs){
  const request=run.requestId?byId('requests',run.requestId):undefined;
  const rfq=run.rfqId?byId('rfqs',run.rfqId):undefined;
  const session=run.sessionId?byId('ahp_sessions',run.sessionId):undefined;
  const order=run.orderId?byId('orders',run.orderId):undefined;
  if(run.requestId&&(!request||request.runId!==run.id||request.productId!==run.productId||request.quantity!==run.quantity))fail(run.id);
  if(run.rfqId&&(!rfq||rfq.runId!==run.id||rfq.requestId!==run.requestId||rfq.productId!==run.productId||!request))fail(run.id);
  if(run.sessionId&&(!session||session.runId!==run.id||session.rfqId!==run.rfqId||!rfq))fail(run.id);
  if(run.orderId&&(!order||order.runId!==run.id||order.sessionId!==run.sessionId||order.rfqId!==run.rfqId||order.productId!==run.productId||!session))fail(run.id);
 }
 for(const table of ['requests','rfqs','ahp_sessions','approvals','orders'] as const)for(const data of records[table]){
  if(!data.runId)continue;
  const run=runs.get(data.runId);if(!run)fail(data.runId);
  if(table==='requests'&&run!.requestId!==data.id)fail(run!.id);
  if(table==='rfqs'&&(run!.rfqId!==data.id||run!.requestId!==data.requestId))fail(run!.id);
  if(table==='ahp_sessions'&&run!.rfqId!==data.rfqId)fail(run!.id);
  if(table==='approvals'&&(run!.requestId!==data.requestId||(data.rfqId&&run!.rfqId!==data.rfqId)))fail(run!.id);
  if(table==='orders'&&run!.orderId!==data.id)fail(run!.id);
 }
}

/** Rules the old JSON store could not enforce and the typed columns cannot
 * express on their own. They judge what was true when each document was made:
 * a supplier that is inactive now, or a quotation that has expired since, does
 * not make an old PO invalid. */
function validateBusinessChains(records:LegacyRecords){
 const fail=(table:Table,id:string,why:string):never=>{throw new Error(`Legacy ${table} record ${id} is inconsistent: ${why}`)};
 const index=(table:Table)=>new Map(records[table].map(data=>[data.id,data]));
 const requests=index('requests'),rfqs=index('rfqs'),sessions=index('ahp_sessions'),orders=index('orders');
 const approved=(gate:number,match:(approval:RecordData)=>boolean)=>records.approvals.some(a=>a.gate===gate&&a.status==='approved'&&match(a));
 for(const rfq of records.rfqs){
  const request=requests.get(rfq.requestId);
  if(!request||request.status!=='approved'||!approved(1,a=>a.requestId===rfq.requestId))fail('rfqs',rfq.id,'its request has no approved gate 1 decision');
  if(rfq.productId!==request!.productId||rfq.quantity!==request!.quantity)fail('rfqs',rfq.id,'product or quantity differs from its request');
 }
 for(const quotation of records.quotations){
  const rfq=rfqs.get(quotation.rfqId);
  if(rfq&&quotation.quantity<rfq.quantity)fail('quotations',quotation.id,'offers less than the requested quantity');
 }
 for(const session of records.ahp_sessions){
  if(session.revision!==undefined&&session.revision!==1)fail('ahp_sessions',session.id,'only revision 1 is supported');
  const rfq=rfqs.get(session.rfqId);
  for(const candidate of session.quotationSnapshots??[])if(rfq&&candidate.quantity<rfq.quantity)fail('ahp_sessions',session.id,'a candidate offers less than the requested quantity');
 }
 for(const approval of records.approvals)if(approval.gate===2&&approval.revision!==undefined&&approval.revision!==1)fail('approvals',approval.id,'only revision 1 is supported');
 for(const order of records.orders){
  const rfq=rfqs.get(order.rfqId),session=sessions.get(order.sessionId);
  if(!rfq||!session||session.rfqId!==rfq.id)fail('orders',order.id,'its RFQ or AHP session is missing');
  if(order.quantity!==rfq!.quantity||order.productId!==rfq!.productId||order.requestId!==rfq!.requestId)fail('orders',order.id,'product or quantity differs from the approved demand');
  if(session!.status!=='approved'||session!.consistent!==true||!(session!.cr<=0.1))fail('orders',order.id,'its AHP session is not approved and consistent');
  if(!approved(2,a=>a.sessionId===session!.id&&a.supplierId===order.supplierId))fail('orders',order.id,'no approved gate 2 decision selects its supplier');
 }
 for(const receipt of records.receipts){
  const order=orders.get(receipt.orderId),input=receipt.input;
  if(!order||receipt.productId!==order.productId||receipt.supplierId!==order.supplierId)fail('receipts',receipt.id,'product or supplier differs from its PO');
  if(!input||typeof input!=='object'||Array.isArray(input))fail('receipts',receipt.id,'its original request is missing');
  for(const key of ['orderId','quantity','acceptedQuantity','idempotencyKey'])if(input[key]!==receipt[key])fail('receipts',receipt.id,`original request ${key} differs from the stored value`);
  if((input.notes??'')!==(receipt.notes??''))fail('receipts',receipt.id,'original request notes differ from the stored value');
  // The stored header is UTC while the request keeps its own offset: compare instants.
  const stored=Date.parse(receipt.receivedAt),sent=typeof input.receivedAt==='string'?Date.parse(input.receivedAt):NaN;
  if(!Number.isFinite(stored)||stored!==sent)fail('receipts',receipt.id,'original request time differs from the stored value');
  if(stored<Date.parse(order!.createdAt)-60000)fail('receipts',receipt.id,'it precedes its PO');
 }
 for(const evaluation of records.evaluations){
  const order=orders.get(evaluation.orderId);
  if(!order||evaluation.productId!==order.productId||evaluation.supplierId!==order.supplierId)fail('evaluations',evaluation.id,'product or supplier differs from its PO');
 }
}
