import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Database} from '../src/db';
import {Procurement} from '../src/procurement';
import {seedDemo} from '../src/database/demo';

test('the demo story fills an empty installation once and refuses one that already has requests',async()=>{
 const db=await Database.open(':memory:');
 try{
  await seedDemo(db,true);
  const data=await new Procurement(db).bootstrap();
  assert.deepEqual(data.orders.map((o:any)=>o.status).sort(),['partially_received','received']);
  assert.equal(data.orders.find((o:any)=>o.status==='partially_received').items.length,2);
  assert.equal(data.evaluations.length,1);
  assert.equal(data.approvals.filter((a:any)=>a.status==='pending').length,1);
  assert.equal(data.requests.length,3);
  await assert.rejects(()=>seedDemo(db,true),/already has purchase requests/);
  assert.equal((await new Procurement(db).bootstrap()).requests.length,3);
 }finally{await db.close()}
});
