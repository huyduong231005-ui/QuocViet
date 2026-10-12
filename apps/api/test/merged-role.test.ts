import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {hashPassword,Auth} from '../src/auth';
import {Database} from '../src/db';
import {migrationDefinitions} from '../src/database/schema';
import {accountCreateSchema,accountUpdateSchema} from '../src/validation';

test('merging warehouse accounts preserves identity, credentials and historical audit roles',async()=>{
 const pg=new PGlite();
 try{
  const migrations=await migrationDefinitions();
  for(const migration of migrations.filter(m=>m.version<3))await pg.exec(migration.sql);
  const hash=hashPassword('Fixture@12345');
  await pg.query("INSERT INTO procurement.users(id,name,email,role,password_hash,active,demo) VALUES ('existing-warehouse','Kho cũ','warehouse@example.test','warehouse',$1,false,false)",[hash]);
  await pg.exec("INSERT INTO procurement.audit(id,actor_kind,actor_user_id,actor_name,actor_role,action,detail) VALUES ('old-audit','user','existing-warehouse','Kho cũ','warehouse','receipt','{}')");
  await pg.exec(await readFile(new URL('../migrations/003_merge_buying_warehouse.sql',import.meta.url),'utf8'));
  const user=(await pg.query<any>("SELECT id,name,email,role,password_hash,active FROM procurement.users WHERE id='existing-warehouse'")).rows[0];
  assert.deepEqual(user,{id:'existing-warehouse',name:'Kho cũ',email:'warehouse@example.test',role:'buyer',password_hash:hash,active:false});
  assert.equal((await pg.query<any>("SELECT actor_role FROM procurement.audit WHERE id='old-audit'")).rows[0].actor_role,'warehouse');
  await assert.rejects(()=>pg.exec("UPDATE procurement.users SET role='warehouse' WHERE id='existing-warehouse'"),/check constraint/);
 }finally{await pg.close()}
});

test('new account settings reject the retired warehouse role and changed roles revoke old sessions',async()=>{
 assert.equal(accountCreateSchema.safeParse({name:'Nhân viên',email:'new@example.test',role:'warehouse',password:'MatKhau2026'}).success,false);
 assert.equal(accountUpdateSchema.safeParse({role:'warehouse'}).success,false);
 const db=await Database.open(':memory:');
 try{
  const passwordHash=hashPassword('Fixture@12345');
  await db.transaction(repo=>repo.put('users',{id:'person',name:'Nhân viên',email:'person@example.test',role:'auditor',passwordHash,active:true,demo:false,createdAt:new Date().toISOString()}));
  const auth=new Auth(db,'test-secret'),login=await auth.login('person@example.test','Fixture@12345');
  await db.transaction(async repo=>repo.put('users',{...(await repo.get('users','person'))!,role:'buyer'}));
  await assert.rejects(()=>auth.authenticate(`Bearer ${login.token}`),/Phiên đăng nhập/);
  assert.equal((await auth.login('person@example.test','Fixture@12345')).user.role,'buyer');
 }finally{await db.close()}
});
