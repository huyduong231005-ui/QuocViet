import {PGlite} from '@electric-sql/pglite';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TABLES} from '../src/database/contracts';
import {migrateEmbedded} from '../src/database/migrate';
import {legacyV1Fixture} from './fixtures/legacy-v1';

async function source(pg:PGlite,change:(records:any)=>void){
 const records:any=structuredClone(legacyV1Fixture);change(records);
 for(const table of TABLES){
  await pg.exec(`CREATE TABLE public.${table}(id text PRIMARY KEY,data jsonb NOT NULL)`);
  for(const data of records[table])await pg.query(`INSERT INTO public.${table}(id,data) VALUES($1,$2::jsonb)`,[data.id,JSON.stringify(data)]);
 }
 return records;
}
const receipt=(records:any)=>records.receipts[0];
const gate=(records:any,number:number)=>records.approvals.find((data:any)=>data.gate===number);
const malformed:[string,(records:any)=>void][]=[
 ['empty receipt input',data=>{receipt(data).input={}}],
 ['receipt input quantities differ from its persisted quantities',data=>{Object.assign(receipt(data).input,{quantity:1,acceptedQuantity:1})}],
 ['receipt input quantity differs',data=>{receipt(data).input.quantity=11}],
 ['receipt input acceptedQuantity differs',data=>{receipt(data).input.acceptedQuantity=8}],
 ['receipt input orderId differs',data=>{receipt(data).input.orderId='nonexistent-order'}],
 ['receipt input idempotencyKey differs',data=>{receipt(data).input.idempotencyKey='another-key'}],
 ['receipt input receivedAt instant differs',data=>{receipt(data).input.receivedAt='2026-10-02T00:08:10Z'}],
 ['receipt input notes differ',data=>{receipt(data).input.notes='Different notes'}],
 ['receipt input timestamp violates the known request contract',data=>{receipt(data).input.receivedAt='not-a-timestamp'}],
 ['receipt precedes PO creation by more than the permitted minute',data=>{receipt(data).receivedAt=receipt(data).input.receivedAt='2026-09-30T23:58:59Z'}],
 ['PO quantity differs from demand despite its correct total',data=>{Object.assign(data.orders[0],{quantity:11,total:119087,status:'partially_received'})}],
 ['live quotation offers less than demand',data=>{data.quotations[0].quantity=9}],
 ['immutable candidate offers less than demand',data=>{data.ahp_sessions[1].quotationSnapshots[0].quantity=9;data.orders[0].quotationSnapshot.quantity=9}],
 ['PO is backed by a rejected gate2 and rejected session',data=>{gate(data,2).status='rejected';data.ahp_sessions[1].status='rejected'}],
 ['PO is backed by an inconsistent session',data=>{Object.assign(data.ahp_sessions[1],{cr:.2,consistent:false})}],
 ['PO consistency flag does not excuse CR above the threshold',data=>{data.ahp_sessions[1].cr=.2}],
 ['PO lacks its approved gate1 decision',data=>{data.approvals=data.approvals.filter((a:any)=>a.gate!==1)}],
 ['RFQ is backed by a rejected gate1 and request',data=>{gate(data,1).status='rejected';data.requests[0].status='rejected'}],
 ['PO selected supplier differs from its approved gate2 choice',data=>{gate(data,2).supplierId='supplier-a'}],
 ['PO approval belongs to another session and revision',data=>{Object.assign(data.ahp_sessions[0],{status:'approved',revision:2});Object.assign(gate(data,2),{sessionId:'session-1',revision:2})}],
 ['evaluation product differs from the PO product',data=>{data.evaluations[0].productId='empty-product'}],
 ['PO status ordered contradicts received counters',data=>{data.orders[0].status='ordered'}],
 ['PO status partially_received contradicts fully received counters',data=>{data.orders[0].status='partially_received'}],
];

for(const [name,change] of malformed)test(`legacy migration atomically rejects ${name}`,async()=>{
 const pg=new PGlite();try{
  const records=await source(pg,change);
  await assert.rejects(migrateEmbedded(pg),/legacy|Legacy/);
  assert.equal((await pg.query<any>("SELECT count(*)::int count FROM information_schema.tables WHERE table_schema='public'")).rows[0].count,17);
  assert.equal((await pg.query<any>("SELECT count(*)::int count FROM pg_namespace WHERE nspname IN ('procurement','legacy_json_v1')")).rows[0].count,0);
  for(const table of TABLES){
   const rows=(await pg.query<any>(`SELECT data FROM public.${table} ORDER BY id`)).rows;
   assert.deepEqual(rows.map(row=>row.data),[...records[table]].sort((a:any,b:any)=>a.id.localeCompare(b.id)),`${table} source changed after rollback`);
  }
 }finally{await pg.close()}
});

test('historical PO still migrates with currently inactive suppliers and expired quotations',async()=>{
 const pg=new PGlite();try{
  await source(pg,data=>{
   for(const supplier of data.suppliers)supplier.active=false;
   for(const quote of data.quotations)quote.validUntil='2026-10-01';
   for(const session of data.ahp_sessions)for(const quote of session.quotationSnapshots)quote.validUntil='2026-10-01';
   data.orders[0].quotationSnapshot.validUntil='2026-10-01';
  });
  await migrateEmbedded(pg);
  assert.equal((await pg.query<any>('SELECT version FROM procurement.schema_migrations')).rows[0].version,1);
 }finally{await pg.close()}
});

test('no-PO stale session retains its historically approved gate2 decision',async()=>{
 const pg=new PGlite();try{
  await source(pg,data=>{
   data.orders=[];data.receipts=[];data.evaluations=[];data.outbox=data.outbox.filter((m:any)=>m.type!=='PO');
   delete data.agent_runs[0].orderId;data.agent_runs[0].status='ready_to_order';data.agent_runs[0].stage=3;
   data.ahp_sessions[1].status='stale';
  });
  await migrateEmbedded(pg);
  assert.equal((await pg.query<any>("SELECT status FROM procurement.approvals WHERE id='gate-2'")).rows[0].status,'approved');
 }finally{await pg.close()}
});

test('receipt input can retain an equivalent timestamp offset and receive exactly one minute before PO',async()=>{
 const pg=new PGlite();try{
  const records=await source(pg,data=>{receipt(data).receivedAt='2026-09-30T23:59:00Z';receipt(data).input.receivedAt='2026-10-01T06:59:00+07:00'});
  await migrateEmbedded(pg);
  const row=(await pg.query<any>('SELECT received_at,input_payload FROM procurement.receipts')).rows[0];
  assert.equal(new Date(row.received_at).toISOString(),'2026-09-30T23:59:00.000Z');
  assert.deepEqual(row.input_payload,records.receipts[0].input);
 }finally{await pg.close()}
});
