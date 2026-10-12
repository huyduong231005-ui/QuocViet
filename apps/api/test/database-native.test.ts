import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Client} from 'pg';
import {Database,TABLES} from '../src/db';
import {Procurement} from '../src/procurement';
import {RECONCILIATION} from '../src/database/legacy';
import {legacyV1Fixture,fixtureAdminHash} from './fixtures/legacy-v1';
import {provisionRoles,runtimeUrl} from '../src/database/roles';
import {migrationDefinitions} from '../src/database/schema';

// Runs only against a real PostgreSQL server: TEST_DATABASE_URL names an
// administrative connection on a disposable cluster. Every test creates and
// drops its own database, so nothing is shared and nothing is left behind.
const adminUrl=process.env.TEST_DATABASE_URL;
const skip=adminUrl?false:'TEST_DATABASE_URL is not set';
const buyer={id:'u-buyer',name:'Buyer',role:'buyer'},manager={id:'u-manager',name:'Manager',role:'manager'},warehouse={id:'u-warehouse',name:'Warehouse',role:'warehouse'};
const matrix=[[1,2,4,4],[.5,1,2,2],[.25,.5,1,1],[.25,.5,1,1]];

async function scratch(run:(url:string)=>Promise<void>){
 const name=`quocviet_test_${randomBytes(6).toString('hex')}`,admin=new Client({connectionString:adminUrl});
 const url=new URL(adminUrl!);url.pathname=`/${name}`;
 await admin.connect();
 try{
  await admin.query(`CREATE DATABASE ${name}`);
  try{await run(url.toString())}finally{await admin.query(`DROP DATABASE ${name} WITH (FORCE)`)}
 }finally{await admin.end()}
}
async function connected<T>(url:string,run:(client:Client)=>Promise<T>){const client=new Client({connectionString:url});await client.connect();try{return await run(client)}finally{await client.end()}}
async function reconciled(url:string){await connected(url,async client=>{for(const [name,sql] of Object.entries(RECONCILIATION))assert.equal((await client.query(sql)).rows.length,0,name)})}
/** Demo catalog, one approved request for 100 reams and a PO for it. */
async function ordered(service:Procurement){
 const request=await service.act('request',buyer,{productId:'pro-paper',quantity:100,reason:'Kiểm thử PostgreSQL'});
 const gate1=(await service.bootstrap()).approvals.find((a:any)=>a.requestId===request.id);
 await service.act('decide',manager,{approved:true},gate1.id);
 const rfq=await service.act('rfq',buyer,{requestId:request.id,supplierIds:['sup-anphat','sup-minhchau']});
 for(const supplierId of ['sup-anphat','sup-minhchau'])await service.act('quotation',buyer,{rfqId:rfq.id,supplierId,quantity:100,unitPrice:70000,deliveryDays:3,qualityScore:90,vat:8,currency:'VND',validUntil:'2099-12-31'});
 const session=await service.act('ahp',buyer,{rfqId:rfq.id,matrix,iterations:100});
 const gate2=await service.act('approval2',buyer,{},session.id);
 await service.act('decide',manager,{approved:true},gate2.id);
 return service.act('order',buyer,{sessionId:session.id});
}

test('native startup refuses an unmigrated database and never runs DDL itself',{skip},()=>scratch(async url=>{
 await assert.rejects(Database.open(':memory:',url),/administrative migration|procurement schema/);
 await connected(url,async client=>assert.equal((await client.query("SELECT count(*)::int count FROM pg_namespace WHERE nspname='procurement'")).rows[0].count,0));
 await Database.migrate(url);await Database.migrate(url);
 const db=await Database.open(':memory:',url);await db.close();
 await connected(url,async client=>assert.equal((await client.query('SELECT count(*)::int count FROM procurement.schema_migrations')).rows[0].count,(await migrationDefinitions()).length));
}));

test('native full flow keeps stock, PO counters, PO status and ledger reconciled',{skip},()=>scratch(async url=>{
 await Database.migrate(url);const db=await Database.open(':memory:',url);
 try{
  const service=new Procurement(db);await service.initialize();
  const po=await ordered(service);
  const body={orderId:po.id,quantity:40,acceptedQuantity:38,receivedAt:new Date().toISOString(),idempotencyKey:'native-1'};
  const receipt=await service.act('receipt',warehouse,body);
  assert.equal((await service.act('receipt',warehouse,body)).id,receipt.id);
  await assert.rejects(()=>service.act('receipt',warehouse,{...body,quantity:61,acceptedQuantity:61,idempotencyKey:'native-2'}),/vượt/);
  await service.act('receipt',warehouse,{...body,quantity:60,acceptedQuantity:60,idempotencyKey:'native-2'});
  await service.act('evaluation',buyer,{orderId:po.id,qualityScore:90,serviceScore:95});
  const state=await service.bootstrap();
  assert.equal(state.products.find((p:any)=>p.id==='pro-paper').stock,218);
  const order=state.orders.find((o:any)=>o.id===po.id);
  assert.deepEqual([order.status,order.receivedQuantity,order.acceptedQuantity],['received',100,98]);
  assert.equal(state.rfqs.find((r:any)=>r.id===po.rfqId).status,'closed');
 }finally{await db.close()}
 await reconciled(url);
}));

test('native concurrent receipt lines cannot over-deliver even without any service lock',{skip},()=>scratch(async url=>{
 await Database.migrate(url);const db=await Database.open(':memory:',url);let po:any;
 try{const service=new Procurement(db);await service.initialize();po=await ordered(service)}finally{await db.close()}
 const first=new Client({connectionString:url}),second=new Client({connectionString:url});await first.connect();await second.connect();
 try{
  const lineId=po.items[0].id;
  for(const key of ['race-a','race-b'])await first.query(`INSERT INTO procurement.receipts (id,order_id,idempotency_key,received_at,created_by,request_fingerprint,input_payload) VALUES ($1,$2,$1,now(),'u-warehouse',repeat('a',64),'{}')`,[key,po.id]);
  const line=`INSERT INTO procurement.receipt_lines (id,receipt_id,order_id,order_line_id,product_id,quantity,accepted_quantity) VALUES ($1,$1,$2,$3,'pro-paper',60,60)`;
  // 60 + 60 exceeds the 100 ordered. The second insert waits on the PO line
  // row lock and must then fail its CHECK against the committed counter.
  await first.query('BEGIN');await first.query(line,['race-a',po.id,lineId]);
  await second.query('BEGIN');
  const blocked=second.query(line,['race-b',po.id,lineId]).then(()=>'inserted',error=>error.code);
  assert.equal(await Promise.race([blocked,new Promise(resolve=>setTimeout(()=>resolve('waiting'),500))]),'waiting');
  await first.query('COMMIT');
  assert.equal(await blocked,'23514');await second.query('ROLLBACK');
  // Any role, including this superuser, is refused a direct ledger or counter write.
  for(const sql of [`UPDATE procurement.inventory_balances SET quantity=0 WHERE product_id='pro-paper'`,`UPDATE procurement.order_lines SET received_quantity=0 WHERE id='${lineId}'`,
   `INSERT INTO procurement.inventory_movements (id,product_id,delta,kind,actor_kind) VALUES ('direct','pro-paper',1,'OPENING','system')`])
   await assert.rejects(first.query(sql),(error:any)=>error.code==='23514');
  const row=(await first.query(`SELECT l.received_quantity::int received,o.status,b.quantity::int stock FROM procurement.order_lines l JOIN procurement.orders o ON o.id=l.order_id JOIN procurement.inventory_balances b ON b.product_id=l.product_id WHERE l.id=$1`,[lineId])).rows[0];
  assert.deepEqual(row,{received:60,status:'partially_received',stock:180});
 }finally{await first.end();await second.end()}
 await reconciled(url);
}));

test('native migration of a legacy JSON database keeps accounts and rebuilds stock from receipts',{skip},()=>scratch(async url=>{
 await connected(url,async client=>{for(const table of TABLES){
  await client.query(`CREATE TABLE public.${table}(id text PRIMARY KEY,data jsonb NOT NULL)`);
  for(const data of (legacyV1Fixture as any)[table])await client.query(`INSERT INTO public.${table}(id,data) VALUES($1,$2::jsonb)`,[data.id,JSON.stringify(data)]);
 }});
 await Database.migrate(url);
 const db=await Database.open(':memory:',url);
 try{
  assert.equal((await db.transaction(repo=>repo.get('users','u-admin')))?.passwordHash,fixtureAdminHash);
  assert.equal((await db.transaction(repo=>repo.get('products','product')))?.stock,129);
 }finally{await db.close()}
 await connected(url,async client=>{
  assert.equal((await client.query("SELECT count(*)::int count FROM information_schema.tables WHERE table_schema='legacy_json_v1'")).rows[0].count,17);
  assert.equal((await client.query("SELECT count(*)::int count FROM information_schema.tables WHERE table_schema='public'")).rows[0].count,0);
 });
 await reconciled(url);
}));

test('native migration rolls back completely when legacy data is inconsistent',{skip},()=>scratch(async url=>{
 await connected(url,async client=>{for(const table of TABLES){
  await client.query(`CREATE TABLE public.${table}(id text PRIMARY KEY,data jsonb NOT NULL)`);
  for(const data of (legacyV1Fixture as any)[table])await client.query(`INSERT INTO public.${table}(id,data) VALUES($1,$2::jsonb)`,[data.id,JSON.stringify(table==='products'&&data.id==='product'?{...data,stock:5}:data)]);
 }});
 await assert.rejects(Database.migrate(url),/Legacy stock is below/);
 await connected(url,async client=>{
  assert.equal((await client.query("SELECT count(*)::int count FROM information_schema.tables WHERE table_schema='public'")).rows[0].count,17);
  assert.equal((await client.query("SELECT count(*)::int count FROM pg_namespace WHERE nspname IN ('procurement','legacy_json_v1')")).rows[0].count,0);
 });
}));

test('native real mode starts with a single administrator and no business records',{skip},()=>scratch(async url=>{
 await Database.migrate(url);const db=await Database.open(':memory:',url);
 const saved={email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD};
 process.env.ADMIN_EMAIL='owner@example.test';process.env.ADMIN_PASSWORD='Native@Fixture1';
 try{
  const service=new Procurement(db,false);await service.initialize();await service.initialize();
  const state=await service.bootstrap();
  for(const key of ['products','suppliers','prices','requests','rfqs','quotations','ahpSessions','orders','receipts','evaluations','history','outbox'])assert.equal(state[key].length,0,key);
  assert.deepEqual((await db.transaction(repo=>repo.list('users'))).map(user=>[user.id,user.role,user.active]),[['u-admin','admin',true]]);
 }finally{
  await db.close();
  for(const [key,value] of [['ADMIN_EMAIL',saved.email],['ADMIN_PASSWORD',saved.password]] as const)if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
}));

test('native transactions rerun a deadlock victim, and reads do not wait behind a write',{skip},()=>scratch(async url=>{
 await Database.migrate(url);const db=await Database.open(':memory:',url);
 try{
  let attempts=0;
  assert.equal(await db.transaction(async()=>{if(++attempts===1)throw Object.assign(new Error('deadlock detected'),{code:'40P01'});return attempts}),2);
  attempts=0;
  await assert.rejects(db.transaction(async()=>{attempts++;throw Object.assign(new Error('lock timeout'),{code:'55P03'})}),(error:any)=>error.code==='55P03');
  assert.equal(attempts,1);
  // A write that has not committed holds the global write guard; a read-only
  // transaction must still complete, and must not see the uncommitted row.
  let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);
  const user={id:'u-held',createdAt:new Date().toISOString(),name:'Held',email:'held@example.test',role:'buyer',passwordHash:'fixture-hash',demo:false};
  const write=db.transaction(async repo=>{await repo.put('users',user);await held});
  const read=await Promise.race([db.transaction(repo=>repo.list('users'),{readOnly:true}),new Promise(resolve=>setTimeout(()=>resolve('blocked'),3000))]);
  assert.deepEqual(read,[]);
  release();await write;
  assert.equal((await db.transaction(repo=>repo.list('users'),{readOnly:true})).length,1);
 }finally{await db.close()}
}));

test('native runtime role runs the whole flow but has no DDL and no way into derived or append-only data',{skip},()=>scratch(async url=>{
 const suffix=randomBytes(4).toString('hex'),names={owner:`qv_owner_${suffix}`,app:`qv_app_${suffix}`};
 await Database.migrate(url);
 const password=await provisionRoles(url,names);
 assert.ok(password);
 // Running it again changes neither the grants nor the password.
 assert.equal(await provisionRoles(url,names),undefined);
 const appUrl=runtimeUrl(url,names.app,password!);
 try{
  const db=await Database.open(':memory:',appUrl);
  try{
   const service=new Procurement(db);await service.initialize();
   const po=await ordered(service);
   const body={orderId:po.id,quantity:40,acceptedQuantity:38,receivedAt:new Date().toISOString(),idempotencyKey:'role-1'};
   await service.act('receipt',warehouse,body);
   await service.act('receipt',warehouse,{...body,quantity:60,acceptedQuantity:60,idempotencyKey:'role-2'});
   await service.act('evaluation',buyer,{orderId:po.id,qualityScore:90,serviceScore:95});
   await service.act('send',buyer,{},po.id);
   const created=await service.act('catalog:products:create',buyer,{sku:'ROLE',name:'Role',unit:'cái',minStock:0,stock:0});
   await service.act('catalog:products:update',buyer,{name:'Role 2'},created.id);
   await service.act('catalog:products:delete',buyer,{},created.id);
   const state=await service.bootstrap();
   assert.equal(state.products.find((p:any)=>p.id==='pro-paper').stock,218);
   assert.equal(state.orders.find((o:any)=>o.id===po.id).status,'received');
  }finally{await db.close()}
  await reconciled(url);
  await connected(appUrl,async client=>{
   assert.deepEqual((await client.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0],{rolsuper:false,rolcreatedb:false,rolcreaterole:false});
   for(const sql of [
    'CREATE TABLE procurement.intruder(id text)','CREATE TABLE public.intruder(id text)','DROP TABLE procurement.audit','ALTER TABLE procurement.audit DISABLE TRIGGER ALL',
    "UPDATE procurement.inventory_balances SET quantity=0","INSERT INTO procurement.inventory_movements (id,product_id,delta,kind,actor_kind) VALUES ('x','pro-pen',1,'OPENING','system')",
    'UPDATE procurement.order_lines SET received_quantity=0','UPDATE procurement.orders SET supplier_id=supplier_id',
    "UPDATE procurement.audit SET action='edited'",'DELETE FROM procurement.audit','DELETE FROM procurement.receipts','UPDATE procurement.receipt_lines SET quantity=1',
    'TRUNCATE procurement.audit','TRUNCATE procurement.prices',"INSERT INTO procurement.schema_migrations (version,name,checksum) VALUES (9,'x',repeat('a',64))",
    'DELETE FROM procurement.orders','DELETE FROM procurement.users',
   ])await assert.rejects(client.query(sql),(error:any)=>error.code==='42501',sql);
   // Rules that are triggers rather than privileges still bind the role.
   await assert.rejects(client.query("UPDATE procurement.requests SET status='pending'"),(error:any)=>error.code==='23514');
  });
 }finally{
  // Roles are cluster-wide: release what they own here, then drop them after the database is gone.
  await connected(url,client=>client.query(`REASSIGN OWNED BY ${names.owner} TO CURRENT_USER; DROP OWNED BY ${names.app}; DROP OWNED BY ${names.owner}`));
  await connected(adminUrl!,client=>client.query(`DROP ROLE ${names.app}; DROP ROLE ${names.owner}`));
 }
}));
