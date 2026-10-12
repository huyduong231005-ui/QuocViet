import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from '../src/db';
import { Procurement } from '../src/procurement';
import { Auth } from '../src/auth';
const buyer={id:'u-buyer',name:'Buyer',role:'buyer'},manager={id:'u-manager',name:'Manager',role:'manager'},receiver=buyer,auditor={id:'u-auditor',name:'Auditor',role:'auditor'};
const matrix=[[1,2,4,4],[.5,1,2,2],[.25,.5,1,1],[.25,.5,1,1]];
test('production rejects a previously seeded demo database',async()=>{const db=await Database.open(':memory:');try{await new Procurement(db,true).initialize();await assert.rejects(()=>new Procurement(db,false).initialize(),/CSDL demo/)}finally{await db.close()}});
test('RFQ references block supplier deletion and gate2 revalidates expired snapshot',async()=>{
 const db=await Database.open(':memory:');let time=new Date();const s=new Procurement(db,true,()=>time);await s.initialize();
 try{
  const supplier=await s.act('catalog:suppliers:create',buyer,{name:'New supplier',email:'new@example.test'});
  const request=await s.act('request',buyer,{productId:'pro-paper',quantity:10,reason:'test'});
  let b=await s.bootstrap();await s.act('decide',manager,{approved:true},b.approvals.find((a:any)=>a.requestId===request.id).id);
  const rfq=await s.act('rfq',buyer,{requestId:request.id,supplierIds:[supplier.id,'sup-anphat']});
  await assert.rejects(()=>s.act('catalog:suppliers:delete',buyer,{},supplier.id),/sử dụng/);
  for(const supplierId of [supplier.id,'sup-anphat'])await s.act('quotation',buyer,{rfqId:rfq.id,supplierId,quantity:10,unitPrice:70000,deliveryDays:3,qualityScore:90,vat:8,currency:'VND',validUntil:'2099-12-31'});
  const session=await s.act('ahp',buyer,{rfqId:rfq.id,matrix,iterations:100});
  await assert.rejects(db.transaction(async repo=>{const current=await repo.get('ahp_sessions',session.id);await repo.put('ahp_sessions',{...current!,quotationSnapshots:current!.quotationSnapshots.map((q:any)=>({...q,validUntil:'2000-01-01'}))})}),/immutable/);
  time=new Date('2100-01-01T00:00:00Z');
  await assert.rejects(()=>s.act('approval2',buyer,{},session.id),/hiệu lực|hết hạn/);
 }finally{await db.close()}
});
test('procurement transaction enforces approvals, immutable quotation revisions and partial receipt retries',async()=>{
 const db=await Database.open(':memory:');const s=new Procurement(db);await s.initialize();
 try {
  await assert.rejects(()=>s.act('request',auditor,{productId:'pro-paper',quantity:100,reason:'read only'}),/quyền/);
  const request=await s.act('request',buyer,{productId:'pro-paper',quantity:100,reason:'Giấy A4 cho văn phòng'});
  assert.equal(request.status,'pending');
  await assert.rejects(()=>s.act('rfq',buyer,{requestId:request.id,supplierIds:['sup-anphat','sup-minhchau']}),/duyệt/);
  let b=await s.bootstrap();let gate=b.approvals.find((a:any)=>a.requestId===request.id);
  await assert.rejects(()=>s.act('decide',buyer,{approved:true},gate.id),/quyền/);
  await s.act('decide',manager,{approved:true},gate.id);
  const rfq=await s.act('rfq',buyer,{requestId:request.id,supplierIds:['sup-anphat','sup-minhchau']});
  const quote={rfqId:rfq.id,quantity:100,unitPrice:70000,vat:8,currency:'VND',validUntil:'2099-12-31',deliveryDays:3,qualityScore:95};
  await assert.rejects(()=>s.act('quotation',buyer,{...quote,supplierId:'sup-anphat',unitPrice:-1}),/Đơn giá: phải lớn hơn 0/);
  const q1=await s.act('quotation',buyer,{...quote,supplierId:'sup-anphat'});
  await s.act('quotation',buyer,{...quote,supplierId:'sup-minhchau',unitPrice:72000,deliveryDays:2});
  const session=await s.act('ahp',buyer,{rfqId:rfq.id,matrix,iterations:100});
  assert.equal(session.consistent,true);assert.equal(session.quotationSnapshots.length,2);
  await assert.rejects(()=>s.act('order',buyer,{sessionId:session.id}),/duyệt/);
  gate=await s.act('approval2',buyer,{},session.id);
  await s.act('quotationUpdate',buyer,{unitPrice:75000},q1.id);
  await assert.rejects(()=>s.act('decide',manager,{approved:true},gate.id),/hiệu lực/);
  const current=await s.act('ahp',buyer,{rfqId:rfq.id,matrix,iterations:100});gate=await s.act('approval2',buyer,{},current.id);
  await s.act('decide',manager,{approved:true},gate.id);
  const po=await s.act('order',buyer,{sessionId:current.id});assert.equal((await s.act('order',buyer,{sessionId:current.id})).id,po.id);
  for(const actor of [manager,auditor])await assert.rejects(()=>s.act('receipt',actor,{orderId:po.id,quantity:40,acceptedQuantity:40,receivedAt:new Date().toISOString(),idempotencyKey:'r-1'}),/quyền/);
  const body={orderId:po.id,quantity:40,acceptedQuantity:38,receivedAt:new Date().toISOString(),idempotencyKey:'r-1'};
  const receipt=await s.act('receipt',receiver,body);assert.equal((await s.act('receipt',receiver,body)).id,receipt.id);
  await assert.rejects(()=>s.act('receipt',receiver,{...body,quantity:41}),/idempotency/);
  await assert.rejects(()=>s.act('receipt',receiver,{...body,quantity:61,acceptedQuantity:61,idempotencyKey:'r-2'}),/vượt/);
  await s.act('receipt',receiver,{...body,quantity:60,acceptedQuantity:60,idempotencyKey:'r-2'});
  const evaluation=await s.act('evaluation',buyer,{orderId:po.id,qualityScore:90,serviceScore:95});assert.ok(evaluation.overallScore>0);
  b=await s.bootstrap();assert.equal(b.products.find((p:any)=>p.id==='pro-paper').stock,218);assert.equal(b.orders.find((o:any)=>o.id===po.id).status,'received');
 }finally{await db.close()}
});

test('agent tools cannot bypass either human gate or bind to another run',async()=>{
 const db=await Database.open(':memory:');const s=new Procurement(db);await s.initialize();
 try {
  const run=await s.act('startAgent',buyer,{productId:'pro-paper',quantity:100});
  await s.tool('detect_need',{runId:run.id});
  await assert.rejects(()=>s.tool('prepare_rfq',{runId:run.id}),/duyệt/);
  await assert.rejects(()=>s.tool('finalize',{runId:run.id}),/duyệt|AHP/);
  let b=await s.bootstrap();const gate1=b.approvals.find((a:any)=>a.runId===run.id&&a.gate===1);
  await s.act('decide',manager,{approved:true},gate1.id);
  const setup=await s.tool('prepare_rfq',{runId:run.id});assert.equal((await s.tool('prepare_rfq',{runId:run.id})).rfq.id,setup.rfq.id);
  await s.tool('receive_quotations',{runId:run.id,quotations:setup.suppliers.map((v:any,i:number)=>({rfqId:setup.rfq.id,supplierId:v.id,quantity:100,unitPrice:68000+i*1000,deliveryDays:2+i,qualityScore:90,vat:8,currency:'VND',validUntil:'2099-12-31',source:'demo'}))});
  const result=await s.tool('evaluate',{runId:run.id});assert.ok(result.session.consistent);
  await assert.rejects(()=>s.tool('finalize',{runId:run.id}),/duyệt/);
  await s.act('decide',manager,{approved:false,comment:'Chưa đủ thông tin'},result.approval.id);
  await assert.rejects(()=>s.tool('finalize',{runId:run.id}),/từ chối|duyệt/);
  b=await s.bootstrap();assert.equal(b.orders.length,0);assert.equal(b.agentRuns.find((r:any)=>r.id===run.id).status,'rejected');
 }finally{await db.close()}
});

test('a newer AHP proposal replaces the approved one and only its supplier can be ordered',async()=>{
 const db=await Database.open(':memory:');const s=new Procurement(db);await s.initialize();
 try{
  const request=await s.act('request',buyer,{productId:'pro-paper',quantity:10,reason:'Hai đề xuất'});
  let b=await s.bootstrap();await s.act('decide',manager,{approved:true},b.approvals.find((a:any)=>a.requestId===request.id).id);
  const rfq=await s.act('rfq',buyer,{requestId:request.id,supplierIds:['sup-anphat','sup-minhchau']});
  for(const supplierId of ['sup-anphat','sup-minhchau'])await s.act('quotation',buyer,{rfqId:rfq.id,supplierId,quantity:10,unitPrice:70000,deliveryDays:3,qualityScore:90,vat:8,currency:'VND',validUntil:'2099-12-31'});
  const first=await s.act('ahp',buyer,{rfqId:rfq.id,matrix,iterations:100});
  await s.act('decide',manager,{approved:true,supplierId:'sup-anphat',comment:'Chọn An Phát'},(await s.act('approval2',buyer,{},first.id)).id);
  const second=await s.act('ahp',buyer,{rfqId:rfq.id,matrix,iterations:100});
  const gate=await s.act('approval2',buyer,{},second.id);
  b=await s.bootstrap();
  assert.equal(b.ahpSessions.find((x:any)=>x.id===first.id).status,'stale');
  await assert.rejects(()=>s.act('order',buyer,{sessionId:first.id}),/duyệt/);
  await s.act('decide',manager,{approved:true,supplierId:'sup-minhchau',comment:'Chọn Minh Châu'},gate.id);
  const po=await s.act('order',buyer,{sessionId:second.id});
  assert.equal(po.supplierId,'sup-minhchau');assert.equal(po.status,'ordered');
  // With the PO issued, the RFQ is closed and no further proposal can replace the ordered one.
  await assert.rejects(()=>s.act('ahp',buyer,{rfqId:rfq.id,matrix,iterations:100}),/PO/);
  b=await s.bootstrap();
  assert.equal(b.rfqs.find((x:any)=>x.id===rfq.id).status,'closed');
  assert.equal(b.audit.every((a:any)=>!a.entityId||a.entityType),true);
  assert.equal(b.audit.find((a:any)=>a.entityId===po.id).entityType,'order');
 }finally{await db.close()}
});

test('catalog keeps a product unit, caps opening stock, and a deactivated account loses access at once',async()=>{
 const db=await Database.open(':memory:');const s=new Procurement(db);await s.initialize();
 try{
  await assert.rejects(()=>s.act('catalog:products:update',buyer,{unit:'thùng'},'pro-paper'),/Đơn vị/);
  await s.act('catalog:products:update',buyer,{name:'Giấy A4 80gsm',unit:'ram'},'pro-paper');
  await assert.rejects(()=>s.act('catalog:products:create',buyer,{sku:'BIG',name:'Big',unit:'cái',minStock:0,stock:1e9+1}),/Tồn kho: tối đa 1\.000\.000\.000/);
  const created=await s.act('catalog:products:create',buyer,{sku:'NEW',name:'New',unit:'cái',minStock:0,stock:4});
  assert.equal(created.stock,4);
  const auth=new Auth(db,'s'.repeat(32));
  const {token}=await auth.login('buyer@ahp.local','Demo@12345');
  assert.equal((await auth.authenticate('Bearer '+token)).role,'buyer');
  await db.transaction(async repo=>{await repo.put('users',{...(await repo.get('users','u-buyer'))!,active:false})});
  await assert.rejects(()=>auth.authenticate('Bearer '+token),/Phiên đăng nhập/);
  await assert.rejects(()=>auth.login('buyer@ahp.local','Demo@12345'),/không đúng/);
 }finally{await db.close()}
});

test('quotation expiry follows the Vietnam business day rather than the UTC day',async()=>{
 const db=await Database.open(':memory:');let time=new Date('2026-10-11T16:30:00Z');const s=new Procurement(db,true,()=>time);await s.initialize();
 try{
  const request=await s.act('request',buyer,{productId:'pro-paper',quantity:10,reason:'Hạn báo giá'});
  await s.act('decide',manager,{approved:true},(await s.bootstrap()).approvals.find((a:any)=>a.requestId===request.id).id);
  const rfq=await s.act('rfq',buyer,{requestId:request.id,supplierIds:['sup-anphat','sup-minhchau']});
  for(const supplierId of ['sup-anphat','sup-minhchau'])await s.act('quotation',buyer,{rfqId:rfq.id,supplierId,quantity:10,unitPrice:70000,deliveryDays:3,qualityScore:90,vat:8,currency:'VND',validUntil:'2026-10-11'});
  // 23:30 on the 11th in Vietnam: the quotations are in their last half hour.
  assert.equal((await s.bootstrap()).businessDate,'2026-10-11');
  await s.act('ahp',buyer,{rfqId:rfq.id,matrix,iterations:100});
  // 00:30 on the 12th in Vietnam, still the 11th in UTC: they have expired.
  time=new Date('2026-10-11T17:30:00Z');
  assert.equal((await s.bootstrap()).businessDate,'2026-10-12');
  await assert.rejects(()=>s.act('ahp',buyer,{rfqId:rfq.id,matrix,iterations:100}),/hiệu lực/);
 }finally{await db.close()}
});

test('audit marks a self-approved request and records catalog values before and after',async()=>{
 const db=await Database.open(':memory:');const s=new Procurement(db);await s.initialize();
 try{
  const own=await s.act('request',manager,{productId:'pro-paper',quantity:5,reason:'Quản lý tự tạo'});
  const other=await s.act('request',buyer,{productId:'pro-paper',quantity:5,reason:'Nhân viên tạo'});
  let b=await s.bootstrap();
  const ownGate=b.approvals.find((a:any)=>a.requestId===own.id),otherGate=b.approvals.find((a:any)=>a.requestId===other.id);
  await s.act('decide',manager,{approved:true,comment:'Cần gấp'},ownGate.id);
  await s.act('requestApprove',manager,{approved:false},other.id);
  await s.act('catalog:prices:update',buyer,{unitPrice:71000},'price-0-0');
  await s.act('catalog:prices:update',buyer,{unitPrice:71000},'price-0-0');
  b=await s.bootstrap();
  const decision=(gate:any)=>b.audit.find((a:any)=>a.entityId===gate.id&&['decide','requestApprove'].includes(a.action)).detail;
  assert.deepEqual(decision(ownGate),{approved:true,comment:'Cần gấp',selfApproved:true});
  assert.deepEqual(decision(otherGate),{approved:false,comment:''});
  const priceAudits=b.audit.filter((a:any)=>a.entityId==='price-0-0');
  assert.deepEqual(priceAudits.map((a:any)=>a.detail),[{changes:{unitPrice:{before:68000,after:71000}}},{}]);
  // History carries no VAT and PO totals do, so the dashboard reports both parts of each month.
  for(const month of b.dashboard.monthlySpend)assert.equal(month.value,month.historyValue+month.orderValue);
  assert.ok(b.dashboard.monthlySpend.some((month:any)=>month.historyValue>0));
 }finally{await db.close()}
});

test('a receipt retry is the same request when only the timestamp offset is written differently',async()=>{
 const db=await Database.open(':memory:');const s=new Procurement(db);await s.initialize();
 try{
  const request=await s.act('request',buyer,{productId:'pro-paper',quantity:10,reason:'Thử lại phiếu nhận'});
  await s.act('decide',manager,{approved:true},(await s.bootstrap()).approvals.find((a:any)=>a.requestId===request.id).id);
  const rfq=await s.act('rfq',buyer,{requestId:request.id,supplierIds:['sup-anphat','sup-minhchau']});
  for(const supplierId of ['sup-anphat','sup-minhchau'])await s.act('quotation',buyer,{rfqId:rfq.id,supplierId,quantity:10,unitPrice:70000,deliveryDays:3,qualityScore:90,vat:8,currency:'VND',validUntil:'2099-12-31'});
  const session=await s.act('ahp',buyer,{rfqId:rfq.id,matrix,iterations:100});
  await s.act('decide',manager,{approved:true},(await s.act('approval2',buyer,{},session.id)).id);
  const po=await s.act('order',buyer,{sessionId:session.id});
  const now=new Date(),utc=now.toISOString(),vietnam=new Date(now.getTime()+7*3600000).toISOString().replace('Z','+07:00');
  const body={orderId:po.id,quantity:4,acceptedQuantity:4,idempotencyKey:'offset-retry'};
  const receipt=await s.act('receipt',receiver,{...body,receivedAt:utc});
  assert.equal((await s.act('receipt',receiver,{...body,receivedAt:vietnam})).id,receipt.id);
  await assert.rejects(()=>s.act('receipt',receiver,{...body,receivedAt:new Date(now.getTime()-1000).toISOString()}),/idempotency/);
  assert.equal((await s.bootstrap()).products.find((p:any)=>p.id==='pro-paper').stock,124);
 }finally{await db.close()}
});

test('dashboard and AHP read one supplier score, and an oversized total is reported as missing',async()=>{
 const db=await Database.open(':memory:');const s=new Procurement(db);await s.initialize();
 try{
  const request=await s.act('request',buyer,{productId:'pro-paper',quantity:10,reason:'Một nguồn điểm'});
  await s.act('decide',manager,{approved:true},(await s.bootstrap()).approvals.find((a:any)=>a.requestId===request.id).id);
  const rfq=await s.act('rfq',buyer,{requestId:request.id,supplierIds:['sup-anphat','sup-minhchau']});
  for(const supplierId of ['sup-anphat','sup-minhchau'])await s.act('quotation',buyer,{rfqId:rfq.id,supplierId,quantity:10,unitPrice:70000,deliveryDays:3,qualityScore:90,vat:8,currency:'VND',validUntil:'2099-12-31'});
  const session=await s.act('ahp',buyer,{rfqId:rfq.id,matrix,iterations:100});
  const before=await s.bootstrap();
  for(const candidate of session.quotationSnapshots)assert.equal(candidate.criterionInputs.reputation,before.dashboard.supplierPerformance.find((score:any)=>score.supplierId===candidate.supplierId).score);
  assert.deepEqual(before.dashboard.warnings,[]);
  assert.deepEqual(before.inventory.find((item:any)=>item.productId==='pro-paper').stock,120);
  // One billion units at ten billion VND each is beyond an exact JS integer.
  const huge=await s.act('catalog:products:create',buyer,{sku:'HUGE',name:'Huge',unit:'cái',minStock:0,stock:1e9});
  await s.act('catalog:prices:create',buyer,{productId:huge.id,supplierId:'sup-anphat',unitPrice:1e10,deliveryDays:1,qualityScore:90});
  const after=await s.bootstrap();
  assert.equal(after.dashboard.inventoryValue,null);
  assert.deepEqual(after.dashboard.warnings,['inventoryValue']);
  assert.equal(after.products.length,6);
 }finally{await db.close()}
});
