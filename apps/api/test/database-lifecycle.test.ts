import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Database} from '../src/db';

test('read-only repeatable-read transactions reject writes and failures release the queue',async()=>{
 const db=await Database.open(':memory:');
 const user={id:'user',createdAt:'2026-10-01T00:00:00.000Z',name:'Admin',email:'admin@example.test',role:'admin',passwordHash:'fixture-hash',demo:false};
 try{
  await db.transaction(repo=>repo.put('users',user));
  assert.equal((await db.transaction(repo=>repo.find('users',{email:'ADMIN@EXAMPLE.TEST'}),{readOnly:true,isolation:'REPEATABLE READ'}))[0].id,user.id);
  await assert.rejects(db.transaction(repo=>repo.put('users',{...user,name:'Changed'}),{readOnly:true,isolation:'REPEATABLE READ'}),(error:any)=>error.code==='25006');
  await assert.rejects(db.transaction(async repo=>{await repo.put('users',{...user,name:'Rollback'});throw new Error('Forced rollback')}),/Forced rollback/);
  assert.equal((await db.transaction(repo=>repo.get('users',user.id)))?.name,'Admin');
  await assert.rejects(db.transaction(repo=>repo.list('users'),{statementTimeoutMs:-1}),/timeout/);
  await assert.rejects(db.transaction(repo=>repo.list('users'),{isolation:'SERIALIZABLE' as any}),/isolation/);
  assert.equal((await db.transaction(repo=>repo.list('users'))).length,1);
 }finally{await db.close()}
 await assert.rejects(db.transaction(repo=>repo.list('users')),/closed/);
});
