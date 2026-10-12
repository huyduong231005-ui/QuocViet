import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Database} from '../src/db';
import {Procurement} from '../src/procurement';
import {createApp} from '../src/app';

const buyer={id:'u-buyer',name:'Buyer',role:'buyer'},manager={id:'u-manager',name:'Manager',role:'manager'};
async function workspace(run:(s:Procurement,db:Database)=>Promise<void>){const db=await Database.open(':memory:');try{const s=new Procurement(db);await s.initialize();await run(s,db)}finally{await db.close()}}

test('the audit log is paged, filtered and searched in SQL, newest first',()=>workspace(async(s,db)=>{
 for(let index=0;index<7;index++)await s.act('catalog:suppliers:create',buyer,{name:`NCC ${index}`,email:`ncc${index}@example.test`});
 const request=await s.act('request',manager,{productId:'pro-paper',quantity:5,reason:'Phân trang'});
 // Rows written in the same instant must still page in one fixed order.
 await db.transaction(async repo=>{for(const id of ['same-a','same-b','same-c'])await repo.put('audit',{id,createdAt:'2020-01-01T00:00:00.000Z',actorId:'u-buyer',actorName:'Tên 100%_thật',role:'buyer',action:'fixture',entityType:'product',entityId:id})});

 const all=await s.auditLog({pageSize:100});
 assert.equal(all.total,11);assert.deepEqual([all.page,all.pageSize,all.rows.length],[1,100,11]);
 assert.deepEqual(all.rows.map(row=>row.createdAt),[...all.rows.map(row=>row.createdAt)].sort().reverse());
 assert.deepEqual(all.rows.slice(-3).map(row=>row.id),['same-c','same-b','same-a']);
 const pages=[];for(const page of [1,2,3])pages.push(...(await s.auditLog({page,pageSize:4})).rows.map(row=>row.id));
 assert.deepEqual(pages,all.rows.map(row=>row.id));
 assert.deepEqual((await s.auditLog({page:4,pageSize:4})),{total:11,page:4,pageSize:4,rows:[]});

 assert.equal((await s.auditLog({entityType:'supplier'})).total,7);
 assert.equal((await s.auditLog({action:'request'})).rows[0].entityId,request.id);
 assert.equal((await s.auditLog({search:'manager'})).total,1);
 // The user's % and _ are text, not wildcards.
 assert.equal((await s.auditLog({search:'100%_thật'})).total,3);assert.equal((await s.auditLog({search:'100%x'})).total,0);assert.equal((await s.auditLog({search:'_'})).total,3);
 assert.equal((await s.auditLog({from:'2020-01-01',to:'2020-01-01'})).total,3);
 assert.equal((await s.auditLog({to:'2019-12-31'})).total,0);
 assert.equal((await s.auditLog({from:'2020-01-02',entityType:'product'})).total,0);
 // Query strings arrive as text; empty filters mean no filter.
 assert.equal((await s.auditLog({page:'2',pageSize:'4',search:'',entityType:'',from:'',to:''})).rows.length,4);
 for(const bad of [{pageSize:101},{pageSize:0},{page:0},{page:'x'},{from:'01/01/2020'},{search:'x'.repeat(101)}])await assert.rejects(()=>s.auditLog(bad),(error:any)=>error.statusCode===400);
}));

test('the stock ledger pages by product and kind and keeps the true running balance',()=>workspace(async s=>{
 const all=await s.stockMovements({});
 assert.equal(all.total,5);assert.ok(all.rows.every(row=>row.kind==='OPENING'&&row.balanceAfter===row.delta&&row.actorName==='Hệ thống'));
 assert.deepEqual((await s.stockMovements({productId:'pro-paper'})).rows.map(row=>[row.sku,row.delta,row.unit]),[['VP-A4-80',120,'ram']]);
 assert.equal((await s.stockMovements({kind:'RECEIPT'})).total,0);
 assert.equal((await s.stockMovements({search:'bút'})).rows[0].productId,'pro-pen');
 assert.equal((await s.stockMovements({page:2,pageSize:2})).rows.length,2);
 await assert.rejects(()=>s.stockMovements({kind:'ISSUE'}),(error:any)=>error.statusCode===400);
}));

test('the web bootstrap leaves the growing logs out; they are read through their own routes',async()=>{
 const {app,db}=await createApp({dataDir:':memory:',agentEnabled:false});await app.listen(0,'127.0.0.1');const base=await app.getUrl();
 try{
  const get=async(path:string,token?:string)=>{const response=await fetch(base+'/api'+path,{headers:token?{Authorization:'Bearer '+token}:{}});return {status:response.status,data:await response.json()}};
  const token=(await (await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'auditor@ahp.local',password:'Demo@12345'})})).json()).token;
  const bootstrap=(await get('/bootstrap',token)).data;
  assert.equal('audit' in bootstrap,false);assert.equal('movements' in bootstrap,false);assert.equal(bootstrap.products.length,5);
  for(const path of ['/audit','/inventory/movements'])assert.equal((await get(path)).status,401);
  const movements=await get('/inventory/movements?pageSize=2&kind=OPENING',token);
  assert.deepEqual([movements.status,movements.data.total,movements.data.rows.length],[200,5,2]);
  assert.equal((await get('/audit?page=1&pageSize=5',token)).data.total,0);
  assert.equal((await get('/audit?pageSize=500',token)).status,400);
 }finally{await app.close();await db.close()}
});

test('document lists reach every document, while the workspace keeps only open or recent ones',async()=>{
 const db=await Database.open(':memory:');let time=new Date();const s=new Procurement(db,true,()=>time);await s.initialize();
 const warehouse={id:'u-warehouse',name:'Warehouse',role:'warehouse'},matrix=[[1,2,4,4],[.5,1,2,2],[.25,.5,1,1],[.25,.5,1,1]];
 const gate1=async(requestId:string)=>(await s.documents('approvals',{status:'pending'})).rows.find(row=>row.requestId===requestId)!;
 try{
  // A: a finished chain. B: waiting for gate 1. C: approved, no RFQ yet. D: ordered, not received.
  const order=async(productId:string)=>{
   const request=await s.act('request',buyer,{productId,quantity:10,reason:`Mua ${productId}`});
   await s.act('decide',manager,{approved:true,comment:'Đồng ý'},(await gate1(request.id)).id);
   const rfq=await s.act('rfq',buyer,{requestId:request.id,supplierIds:['sup-anphat','sup-minhchau']});
   for(const supplierId of ['sup-anphat','sup-minhchau'])await s.act('quotation',buyer,{rfqId:rfq.id,supplierId,quantity:10,unitPrice:70000,deliveryDays:3,qualityScore:90,vat:8,currency:'VND',validUntil:'2099-12-31'});
   const session=await s.act('ahp',buyer,{rfqId:rfq.id,matrix,iterations:100});
   await s.act('decide',manager,{approved:true,supplierId:'sup-anphat',comment:'Chọn An Phát'},(await s.act('approval2',buyer,{},session.id)).id);
   return {request,rfq,po:await s.act('order',buyer,{sessionId:session.id})};
  };
  const a=await order('pro-paper');
  await s.act('receipt',warehouse,{orderId:a.po.id,quantity:10,acceptedQuantity:9,receivedAt:new Date().toISOString(),idempotencyKey:'page-a',notes:'Đủ hàng'});
  await s.act('evaluation',buyer,{orderId:a.po.id,qualityScore:90,serviceScore:90});
  const b=await s.act('request',buyer,{productId:'pro-pen',quantity:3,reason:'Chờ duyệt'});
  const c=await s.act('request',buyer,{productId:'pro-tape',quantity:4,reason:'Đã duyệt chưa RFQ'});
  await s.act('decide',manager,{approved:true},(await gate1(c.id)).id);
  const d=await order('pro-toner');

  const total=async(kind:string,query:object={})=>(await s.documents(kind,query)).total;
  assert.deepEqual([await total('requests'),await total('rfqs'),await total('quotations'),await total('approvals'),await total('orders'),await total('receipts'),await total('evaluations')],[4,2,4,6,2,1,1]);
  assert.deepEqual([await total('requests',{status:'pending'}),await total('approvals',{status:'pending'}),await total('approvals',{status:'decided'}),await total('approvals',{gate:2}),await total('orders',{status:'received'})],[1,1,5,2,1]);
  assert.deepEqual([await total('orders',{search:'mực in'}),await total('orders',{search:a.po.id.slice(0,8).toUpperCase()}),await total('requests',{search:'bút bi'}),await total('quotations',{rfqId:a.rfq.id}),await total('receipts',{orderId:d.po.id})],[1,1,1,2,0]);
  // Rows describe themselves: a list does not rely on the rest of the chain being loaded.
  const orders=(await s.documents('orders',{})).rows;
  assert.deepEqual(orders.map(row=>[row.id,row.evaluated,row.items[0].productName]),[[d.po.id,false,'Mực in HP 12A'],[a.po.id,true,'Giấy A4 Double A 80gsm']]);
  assert.deepEqual((await s.documents('receipts',{})).rows[0].items.map((item:any)=>[item.productName,item.unit,item.quantity,item.acceptedQuantity]),[['Giấy A4 Double A 80gsm','ram',10,9]]);
  assert.deepEqual((await s.documents('rfqs',{})).rows.map(row=>[row.status,row.quotationCount]),[['closed',2],['closed',2]]);
  const decided=(await s.documents('approvals',{gate:2})).rows.at(-1)!;
  assert.deepEqual([decided.lines,decided.reason,decided.decidedByName],[[{productId:'pro-paper',quantity:10}],'Mua pro-paper','Quản lý']);
  await assert.rejects(()=>s.documents('users',{}),(error:any)=>error.statusCode===404);
  await assert.rejects(()=>s.documents('orders',{pageSize:500}),(error:any)=>error.statusCode===400);

  const ids=(state:any)=>Object.fromEntries(['requests','rfqs','quotations','ahpSessions','approvals','orders','receipts','evaluations'].map(key=>[key,state[key].map((row:any)=>row.id).sort()]));
  // Everything is recent today, so the workspace has all of it.
  const today=await s.bootstrap(false);
  assert.deepEqual([today.requests.length,today.orders.length,today.receipts.length,today.evaluations.length,'audit' in today],[4,2,1,1,false]);
  // 200 days on, only what still needs someone is loaded: B to approve, C to
  // source, D to receive, with D's receipts-to-be. The finished chain A is gone.
  time=new Date(Date.now()+200*86400000);
  const later=await s.bootstrap(false);
  assert.deepEqual(ids(later),{requests:[b.id,c.id].sort(),rfqs:[],quotations:[],ahpSessions:[],approvals:[(await gate1(b.id)).id],orders:[d.po.id],receipts:[],evaluations:[]});
  assert.equal(new Date(later.workspaceSince).getTime(),time.getTime()-90*86400000);
  assert.equal(later.products.length,5);
  // The full view (reports) and the lists are unaffected by the window.
  assert.equal((await s.bootstrap()).orders.length,2);assert.equal(await total('orders'),2);
 }finally{await db.close()}
});
