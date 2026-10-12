import {PGlite} from '@electric-sql/pglite';
import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Repository} from '../src/database/repository';
import {safeNumber,fingerprint} from '../src/database/contracts';

const at='2026-10-01T00:00:00.000Z';
const record=(id:string,data:object)=>({id,createdAt:at,...data});
let pg:PGlite;
before(async()=>{pg=new PGlite();await pg.exec(await readFile(new URL('../migrations/001_core.sql',import.meta.url),'utf8'))});
after(async()=>{await pg?.close()});
async function isolated(fn:(repo:Repository)=>Promise<void>){await pg.exec('BEGIN');try{const repo=new Repository(pg);await repo.put('users',record('user',{name:'Admin',email:'admin@example.test',role:'admin',passwordHash:'preserved-hash'}));await fn(repo)}finally{await pg.exec('ROLLBACK')}}
async function catalog(repo:Repository){
 await repo.put('products',record('product',{sku:'P',name:'Paper',unit:'box',stock:7,minStock:5}));
 await repo.put('suppliers',record('supplier',{name:'Supplier',email:'s@example.test',reputation:91,phone:'',active:true}));
}
async function chain(repo:Repository,makeOrder=true){
 await catalog(repo);
 await repo.put('requests',record('request',{productId:'product',quantity:10,reason:'Buy',status:'approved',createdBy:'user'}));
 await repo.put('rfqs',record('rfq',{requestId:'request',productId:'product',quantity:10,supplierIds:['supplier'],status:'open'}));
 const q=record('quote',{rfqId:'rfq',supplierId:'supplier',quantity:20,unitPrice:10001,vat:8.25,currency:'VND',deliveryDays:3,qualityScore:90,validUntil:'2099-12-31',source:'manual',updatedAt:'2026-10-02T01:02:03.000Z',supplierName:'Supplier',criterionInputs:{price:10826.0825,quality:90,delivery:3,reputation:91}});
 await repo.put('quotations',q);
 const session=record('session',{rfqId:'rfq',revision:1,status:'approved',criteria:[{id:'price'}],matrix:[[1]],weights:[1],lambdaMax:1,ci:0,cr:0,consistent:true,flattenedCriteria:[{id:'price'}],treeConsistency:[{cr:0}],ranking:[{supplierId:'supplier',supplierName:'Supplier',score:1}],monteCarlo:{iterations:100,seed:42},sensitivity:[],quotationSnapshots:[q]});
 await repo.put('ahp_sessions',session);
 await repo.put('approvals',record('approval',{gate:2,requestId:'request',rfqId:'rfq',sessionId:'session',revision:1,supplierId:'supplier',status:'approved',proposal:'Buy',decidedBy:'user',decidedAt:at}));
 if(makeOrder)await repo.put('orders',record('order',{requestId:'request',rfqId:'rfq',sessionId:'session',supplierId:'supplier',productId:'product',quantity:10,unitPrice:10001,vat:8.25,deliveryDays:3,total:108261,status:'ordered',receivedQuantity:0,acceptedQuantity:0,quotationSnapshot:q}));
 return {q,session};
}

test('catalog uses typed columns, safe stock ledger and real opening actor',()=>isolated(async repo=>{
 repo.setActor({id:'user',name:'Admin',role:'admin'});
 await catalog(repo);
 assert.equal((await repo.get('products','product'))?.stock,7);
 const {rows}=await pg.query<any>('SELECT actor_kind,created_by_user_id,delta::text FROM procurement.inventory_movements');
 assert.deepEqual(rows,[{actor_kind:'user',created_by_user_id:'user',delta:'7'}]);
 await assert.rejects(repo.put('products',{...(await repo.get('products','product'))!,stock:8}),/stock|Tồn/i);
 assert.equal((await repo.find('products',{sku:'P'}))[0].id,'product');
 await assert.rejects(repo.find('products',{unknown:'x'}),/Unknown filter/);
 await assert.rejects(repo.list('invented' as any),/Unknown table/);
}));

test('request child IDs remain short UUIDs and multi-line documents never flatten',()=>isolated(async repo=>{
 await catalog(repo);
 const r=record('r'.repeat(100),{items:[{productId:'product',quantity:1},{productId:'product',quantity:2}],reason:'Two lines',status:'pending',createdBy:'user'});
 await repo.put('requests',r);
 const current=await repo.get('requests',r.id);
 assert.equal(current?.items.length,2);assert.equal(current?.productId,undefined);assert.equal(current?.quantity,undefined);
 for(const item of current!.items)assert.match(item.id,/^[0-9a-f-]{36}$/);
 await repo.put('requests',{...current!,status:'approved'});
 assert.deepEqual((await repo.get('requests',r.id))?.items.map((x:any)=>x.id),current!.items.map((x:any)=>x.id));
 await repo.put('rfqs',record('rfq',{requestId:r.id,requestLineId:current!.items[1].id,supplierIds:['supplier'],status:'open'}));
 assert.equal((await repo.get('rfqs','rfq'))?.quantity,2);
 assert.equal((await repo.find('requests',{productId:'product'})).length,1);
 assert.equal((await repo.find('rfqs',{requestId:r.id})).length,1);
 assert.deepEqual((await repo.get('rfqs','rfq'))?.supplierIds,['supplier']);
}));

test('AHP round-trips all math and quote timestamps with independent candidate IDs',()=>isolated(async repo=>{
 const {q,session}=await chain(repo);
 const stored=await repo.get('ahp_sessions','session');
 for(const key of Object.keys(session))assert.deepEqual(stored?.[key],(session as any)[key],key);
 await repo.put('ahp_sessions',{...session,id:'session-2',status:'draft'});
 const {rows}=await pg.query<any>('SELECT id,quotation_id FROM procurement.ahp_candidates ORDER BY session_id');
 assert.equal(rows.length,2);assert.notEqual(rows[0].id,rows[1].id);assert.equal(rows[0].quotation_id,q.id);
 await repo.put('ahp_sessions',{...stored!,status:'stale',updatedAt:at});
 await assert.rejects(repo.put('ahp_sessions',{...stored!,weights:[.5]}),/immutable/);
 await assert.rejects(repo.put('ahp_sessions',{...stored!,quotationSnapshots:[{...q,validUntil:'2000-01-01'}]}),/immutable/);
}));

test('PO preserves offered terms with demanded quantities and refuses to write derived counters',()=>isolated(async repo=>{
 await chain(repo);
 const order=await repo.get('orders','order');
 assert.equal(order?.quantity,10);assert.equal(order?.quotationSnapshot.quantity,20);assert.equal(order?.total,108261);
 const childId=order!.items[0].id;
 await assert.rejects(repo.put('orders',{...order!,receivedQuantity:4,acceptedQuantity:3,status:'partially_received'}),/derived/);
 const sent=await repo.put('orders',{...order!,status:'received',sentAt:at});
 assert.equal(sent.items[0].id,childId);assert.equal(sent.sentAt,at);assert.equal(sent.status,'ordered');
 assert.deepEqual([sent.items[0].productSku,sent.items[0].productName,sent.items[0].unit],['P','Paper','box']);
 assert.equal((await repo.get('rfqs','rfq'))?.status,'closed');
 await assert.rejects(repo.put('orders',{...order!,unitPrice:1}),/immutable|terms/);
 assert.equal((await repo.find('orders',{rfqId:'rfq'}))[0].id,'order');
}));

test('receipt input retains timestamp offset and inserting it posts counters, status and stock',()=>isolated(async repo=>{
 await chain(repo);repo.setActor({id:'user',name:'Admin',role:'admin'});
 const input={orderId:'order',quantity:4,acceptedQuantity:3,receivedAt:'2026-10-02T07:08:09+07:00',idempotencyKey:'key',notes:''};
 await repo.put('receipts',record('receipt',{...input,input,productId:'product',supplierId:'supplier',createdBy:'user'}));
 const r=await repo.get('receipts','receipt');
 assert.deepEqual(r?.input,input);assert.equal(r?.receivedAt,'2026-10-02T00:08:09.000Z');
 assert.equal((await repo.get('products','product'))?.stock,10);
 const order=await repo.get('orders','order');
 assert.deepEqual([order?.receivedQuantity,order?.acceptedQuantity,order?.status],[4,3,'partially_received']);
 await assert.rejects(repo.put('receipts',{...r!,notes:'edited'}),/immutable/);
 const hash=(await pg.query<any>('SELECT request_fingerprint FROM procurement.receipts')).rows[0].request_fingerprint;
 assert.match(hash,/^[0-9a-f]{64}$/);
 assert.equal((await repo.find('receipts',{idempotencyKey:'key'}))[0].id,'receipt');
}));

test('audit detail and Agent string detail round-trip with binding cycle',()=>isolated(async repo=>{
 await catalog(repo);
 await repo.put('agent_runs',record('run',{productId:'product',createdBy:'user',quantity:10,status:'starting',stage:1,tokensUsed:0,stepCount:0,demo:false}));
 repo.setActor({id:'agent',name:'Agent',role:'agent'},'run');
 await repo.put('requests',record('request',{productId:'product',quantity:10,reason:'Agent',createdBy:'agent',runId:'run',status:'pending'}));
 await repo.put('agent_runs',{...(await repo.get('agent_runs','run'))!,requestId:'request'});
 await repo.put('agent_steps',record('step',{runId:'run',tool:'detect_need',stage:1,status:'completed',detail:'A plain string'}));
 await repo.put('audit',record('audit',{actorId:'agent',actorName:'Agent',role:'agent',action:'tool:detect_need',entityType:'agent_run',entityId:'run',detail:{nested:[1,2]}}));
 assert.equal((await repo.get('requests','request'))?.createdBy,'agent');
 assert.equal((await repo.get('agent_runs','run'))?.requestId,'request');
 assert.equal((await repo.get('agent_steps','step'))?.detail,'A plain string');
 assert.deepEqual((await repo.get('audit','audit'))?.detail,{nested:[1,2]});
 assert.equal((await repo.find('agent_steps',{runId:'run'})).length,1);
}));

test('SQL aggregate helpers preserve existing forecast, supplier score and final-line VND rounding',()=>isolated(async repo=>{
 await chain(repo);
 await repo.put('prices',record('price',{productId:'product',supplierId:'supplier',unitPrice:10001,deliveryDays:3,qualityScore:90}));
 for(const [month,quantity] of [['2026-07',4],['2026-08',6],['2026-09',9]] as const)await repo.put('history',record(month,{productId:'product',supplierId:'supplier',month,quantity,unitPrice:10001,onTime:true,qualityScore:90,synthetic:true}));
 assert.deepEqual(await repo.dashboardSummary(),{totalProducts:1,totalSuppliers:1,pendingApprovals:0,activeOrders:1,inventoryValue:70007});
 assert.deepEqual((await repo.inventoryForecast())[0],{productId:'product',sku:'P',name:'Paper',unit:'box',stock:7,minStock:5,forecast:7,reorderQuantity:0});
 assert.deepEqual((await repo.monthlySpend('Asia/Ho_Chi_Minh')).find((row:any)=>row.month==='2026-10'),{month:'2026-10',value:108261,historyValue:0,orderValue:108261});
 // History is reported apart from PO totals: it carries no VAT.
 assert.deepEqual((await repo.monthlySpend('Asia/Ho_Chi_Minh')).find((row:any)=>row.month==='2026-09'),{month:'2026-09',value:90009,historyValue:90009,orderValue:0});
 assert.deepEqual((await repo.supplierPerformance())[0],{supplierId:'supplier',name:'Supplier',score:94});
}));

test('numeric conversions reject fractional/overflowing integers and canonical fingerprints ignore key order',()=>{
 assert.equal(safeNumber('9007199254740991',true),Number.MAX_SAFE_INTEGER);
 for(const value of ['9007199254740992','9007199254740991.1','1e1000','Infinity','',null])assert.throws(()=>safeNumber(value));
 assert.throws(()=>safeNumber('1.1',true));
 assert.equal(fingerprint({b:[{y:2,x:1}],a:0}),fingerprint({a:0,b:[{x:1,y:2}]}));
});

test('status-only request updates avoid child DML and invitations retain their original order',()=>isolated(async repo=>{
 await catalog(repo);
 await repo.put('suppliers',record('aaa',{name:'First alphabetically',email:'a@example.test',reputation:80,active:true}));
 await repo.put('requests',record('request',{productId:'product',quantity:10,reason:'Buy',status:'pending',createdBy:'user'}));
 await pg.exec(`CREATE FUNCTION procurement.forbid_request_line_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'child DML forbidden'; END; $$; CREATE TRIGGER no_request_child_update BEFORE UPDATE ON procurement.request_lines FOR EACH ROW EXECUTE FUNCTION procurement.forbid_request_line_update()`);
 await repo.put('requests',{...(await repo.get('requests','request'))!,status:'approved'});
 await repo.put('rfqs',record('rfq',{requestId:'request',status:'open',supplierIds:['supplier','aaa']}));
 assert.deepEqual((await repo.get('rfqs','rfq'))?.supplierIds,['supplier','aaa']);
}));

test('multi-line PO and receipt project all items and insert lines in global product order',()=>isolated(async repo=>{
 const {q,session}=await chain(repo,false);
 await repo.put('products',record('a-product',{sku:'A',name:'Another product',unit:'box',stock:0,minStock:1}));
 await repo.put('requests',record('request-2',{productId:'a-product',quantity:5,reason:'Another line',status:'approved',createdBy:'user'}));
 await repo.put('rfqs',record('rfq-2',{requestId:'request-2',supplierIds:['supplier'],status:'open'}));
 const q2={...q,id:'quote-2',rfqId:'rfq-2'};await repo.put('quotations',q2);
 await repo.put('ahp_sessions',{...session,id:'session-2',rfqId:'rfq-2',quotationSnapshots:[q2]});
 await repo.put('approvals',record('approval-2',{gate:2,requestId:'request-2',rfqId:'rfq-2',sessionId:'session-2',supplierId:'supplier',status:'approved',proposal:'Buy',decidedBy:'user',decidedAt:at}));
 const line={rfqId:'rfq',sessionId:'session',productId:'product',quantity:10,unitPrice:10001,vat:8.25,deliveryDays:3,receivedQuantity:0,acceptedQuantity:0,quotationSnapshot:q};
 const order=await repo.put('orders',record('multi-order',{supplierId:'supplier',status:'ordered',items:[line,{...line,rfqId:'rfq-2',sessionId:'session-2',productId:'a-product',quantity:5,quotationSnapshot:q2}]}));
 assert.equal(order.items.length,2);assert.equal(order.productId,undefined);assert.equal(order.quantity,undefined);assert.equal(order.total,162391);
 for(const item of order.items)assert.match(item.id,/^[0-9a-f-]{36}$/);
 const items=order.items.map((line:any)=>({orderLineId:line.id,quantity:3,acceptedQuantity:line.productId==='product'?2:1}));
 const input={orderId:order.id,idempotencyKey:'multi-key',receivedAt:at,notes:'',items};
 const writes:string[]=[];const posting=new Repository({query:async(sql,values)=>{if(sql.startsWith('INSERT INTO procurement.receipt_lines'))writes.push(values![2]);return pg.query(sql,values)}});
 const receipt=await posting.put('receipts',record('multi-receipt',{...input,input,createdBy:'user'}));
 assert.equal(receipt.items.length,2);assert.equal(receipt.productId,undefined);assert.equal(receipt.quantity,undefined);
 assert.deepEqual(writes,['a-product','product']);assert.equal((await repo.get('products','product'))?.stock,9);assert.equal((await repo.get('products','a-product'))?.stock,1);
 // A zero accepted item retains its receipt, but never creates a movement.
 const zeroInput={...input,idempotencyKey:'zero-key',items:items.map(item=>({...item,quantity:1,acceptedQuantity:0}))};
 const zero=await repo.put('receipts',record('zero-receipt',{...zeroInput,input:zeroInput,createdBy:'user'}));
 assert.equal(zero.items.length,2);assert.equal((await pg.query<any>("SELECT count(*)::int count FROM procurement.inventory_movements WHERE kind='RECEIPT'")).rows[0].count,2);
}));

test('listing documents costs a fixed number of statements however many rows there are',()=>isolated(async repo=>{
 await chain(repo);
 const input={orderId:'order',quantity:4,acceptedQuantity:3,receivedAt:at,idempotencyKey:'count-key',notes:''};
 await repo.put('receipts',record('receipt',{...input,input,createdBy:'user'}));
 let statements=0;const counting=new Repository({query:(sql,values)=>{statements++;return pg.query(sql,values)}});
 const cost=async(table:Parameters<Repository['list']>[0])=>{statements=0;const rows=await counting.list(table);assert.ok(rows.length>0,table);return statements};
 assert.deepEqual([await cost('requests'),await cost('rfqs'),await cost('ahp_sessions'),await cost('orders'),await cost('receipts'),await cost('products')],[2,2,2,3,2,1]);
 for(let index=0;index<20;index++)await repo.put('requests',record(`extra-${index}`,{items:[{productId:'product',quantity:1},{productId:'product',quantity:2}],reason:'More',status:'pending',createdBy:'user'}));
 assert.equal(await cost('requests'),2);
 assert.equal((await repo.list('requests')).length,21);
 assert.deepEqual((await repo.get('requests','extra-7'))?.items.map((item:any)=>item.quantity),[1,2]);
}));
