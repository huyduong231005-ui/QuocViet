import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Database} from '../src/db';
import {Procurement} from '../src/procurement';
import {Auth} from '../src/auth';
import {Accounts} from '../src/accounts';
import {createApp} from '../src/app';

const admin={id:'u-admin',name:'Quản trị viên',role:'admin'},buyer={id:'u-buyer',name:'Buyer',role:'buyer'};
async function workspace(run:(accounts:Accounts,auth:Auth,db:Database)=>Promise<void>){
 const db=await Database.open(':memory:');
 try{await new Procurement(db).initialize();await run(new Accounts(db),new Auth(db,'s'.repeat(32)),db)}finally{await db.close()}
}
const fresh={name:'Trần Thu Mua',email:'Thu.Mua@Example.Test',role:'buyer',password:'MatKhau2026'};

test('only an administrator manages accounts, and no response carries a password hash',()=>workspace(async(accounts,auth)=>{
 for(const call of [()=>accounts.list(buyer),()=>accounts.create(buyer,fresh),()=>accounts.update(buyer,'u-buyer',{role:'admin'}),()=>accounts.resetPassword(buyer,'u-admin',{password:'MatKhau2026'})])
  await assert.rejects(call,(error:any)=>error.statusCode===403);
 const created=await accounts.create(admin,fresh);
 assert.deepEqual(Object.keys(created).sort(),['active','createdAt','email','id','name','role']);
 assert.deepEqual([created.email,created.role,created.active],['thu.mua@example.test','buyer',true]);
 const listed=await accounts.list(admin);
 assert.equal(listed.length,6);assert.equal(JSON.stringify(listed).includes('assword'),false);
 assert.equal((await auth.login('THU.MUA@example.test','MatKhau2026')).user.role,'buyer');
 await assert.rejects(()=>accounts.create(admin,{...fresh,name:'Trùng email'}),(error:any)=>error.statusCode===409);
 for(const bad of [{...fresh,email:'khong-phai-email'},{...fresh,email:'a@example.test',role:'owner'},{...fresh,email:'b@example.test',password:'ngan1'},{...fresh,email:'c@example.test',password:'khongcochuso'},{...fresh,email:'d@example.test',password:'1234567890'}])
  await assert.rejects(()=>accounts.create(admin,bad),(error:any)=>error.statusCode===400);
 await assert.rejects(()=>accounts.update(admin,'missing',{name:'X'}),(error:any)=>error.statusCode===404);
}));

test('role change, deactivation and password reset end existing sessions at once',()=>workspace(async(accounts,auth)=>{
 const created=await accounts.create(admin,fresh);
 const session=async()=>'Bearer '+(await auth.login(fresh.email,fresh.password)).token;
 let token=await session();
 assert.equal((await auth.authenticate(token)).role,'buyer');
 assert.equal((await accounts.update(admin,created.id,{role:'manager'})).role,'manager');
 await assert.rejects(()=>auth.authenticate(token),/Phiên đăng nhập/);
 token=await session();
 assert.equal((await auth.authenticate(token)).role,'manager');
 await accounts.resetPassword(admin,created.id,{password:'MatKhauMoi2027'});
 await assert.rejects(()=>auth.authenticate(token),/Phiên đăng nhập/);
 await assert.rejects(()=>auth.login(fresh.email,fresh.password),/không đúng/);
 token='Bearer '+(await auth.login(fresh.email,'MatKhauMoi2027')).token;
 await accounts.update(admin,created.id,{active:false});
 await assert.rejects(()=>auth.authenticate(token),/Phiên đăng nhập/);
 await assert.rejects(()=>auth.login(fresh.email,'MatKhauMoi2027'),/không đúng/);
 await accounts.update(admin,created.id,{active:true});
 assert.equal((await auth.login(fresh.email,'MatKhauMoi2027')).user.id,created.id);
}));

test('the last active administrator cannot be locked out or demoted',()=>workspace(async(accounts)=>{
 await assert.rejects(()=>accounts.update(admin,'u-admin',{active:false}),/tự khóa/);
 await assert.rejects(()=>accounts.update(admin,'u-admin',{role:'buyer'}),/tự khóa/);
 const second=await accounts.create(admin,{...fresh,role:'admin'});
 const other={id:second.id,name:second.name,role:'admin'};
 // Either administrator may now step the other down, but not both.
 assert.equal((await accounts.update(other,'u-admin',{role:'auditor'})).role,'auditor');
 await assert.rejects(()=>accounts.update(other,second.id,{active:false}),/tự khóa/);
 await assert.rejects(()=>accounts.update({...admin,role:'auditor'},second.id,{active:false}),(error:any)=>error.statusCode===403);
 const third=await accounts.create(other,{...fresh,email:'third@example.test',role:'admin'});
 await accounts.update(other,third.id,{active:false});
 await assert.rejects(()=>accounts.update({id:third.id,name:'x',role:'admin'},second.id,{role:'buyer'}),/ít nhất một quản trị viên/);
}));

test('a user changes their own password with the current one, and account changes are audited without secrets',()=>workspace(async(accounts,auth,db)=>{
 const created=await accounts.create(admin,fresh),self={id:created.id,name:created.name,role:'buyer'};
 await assert.rejects(()=>accounts.changeOwnPassword(self,{currentPassword:'sai',newPassword:'MatKhauMoi2027'}),/hiện tại không đúng/);
 await accounts.changeOwnPassword(self,{currentPassword:fresh.password,newPassword:'MatKhauMoi2027'});
 assert.equal((await auth.login(fresh.email,'MatKhauMoi2027')).user.id,created.id);
 await accounts.update(admin,created.id,{name:'Trần Thu Mua',role:'warehouse'});
 await accounts.update(admin,created.id,{role:'warehouse'});
 const audit=(await db.transaction(repo=>repo.find('audit',{entityId:created.id}),{readOnly:true})).map(row=>[row.action,row.entityType,row.detail]);
 assert.deepEqual(audit,[['account:create','user',{role:'buyer'}],['account:password','user',{}],['account:update','user',{changes:{role:{before:'buyer',after:'warehouse'}}}],['account:update','user',{}]]);
 assert.equal(/MatKhau|passwordHash|[0-9a-f]{64}/.test(JSON.stringify(audit)),false);
}));

test('account routes require a signed-in administrator over HTTP',async()=>{
 const {app,db}=await createApp({dataDir:':memory:',agentEnabled:false});await app.listen(0,'127.0.0.1');const base=await app.getUrl();
 const call=async(path:string,method='GET',body?:any,token?:string)=>{const response=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()}};
 try{
  assert.equal((await call('/accounts')).status,401);
  const buyerToken=(await call('/auth/login','POST',{email:'buyer@ahp.local',password:'Demo@12345'})).data.token;
  assert.equal((await call('/accounts','GET',undefined,buyerToken)).status,403);
  const adminToken=(await call('/auth/login','POST',{email:'admin@ahp.local',password:'Demo@12345'})).data.token;
  const created=await call('/accounts','POST',fresh,adminToken);
  assert.equal(created.status,201);assert.equal(created.data.passwordHash,undefined);
  assert.equal((await call('/accounts','GET',undefined,adminToken)).data.length,6);
  assert.equal((await call(`/accounts/${created.data.id}`,'PATCH',{role:'manager'},adminToken)).data.role,'manager');
  assert.equal((await call(`/accounts/${created.data.id}/password`,'POST',{password:'ngan'},adminToken)).status,400);
  const changed=await call('/auth/password','POST',{currentPassword:'Demo@12345',newPassword:'Demo@2026moi'},buyerToken);
  assert.equal(changed.status,201);
  assert.equal((await call('/bootstrap','GET',undefined,buyerToken)).status,401);
 }finally{await app.close();await db.close()}
});

test('a request filed by an administrator is approved at gate 1 at once; a buyer still waits',async()=>{
 const db=await Database.open(':memory:');
 try{
  const s=new Procurement(db);await s.initialize();
  const admin={id:'u-admin',name:'Admin',role:'admin'},buyer={id:'u-buyer',name:'Buyer',role:'buyer'};
  const own=await s.act('request',admin,{reason:'Giấy cho quý 4',items:[{productId:'pro-paper',quantity:10}]});
  const waiting=await s.act('request',buyer,{reason:'Mực in',items:[{productId:'pro-toner',quantity:2}]});
  const data=await s.bootstrap(),gate=(id:string)=>data.approvals.find((a:any)=>a.requestId===id&&a.gate===1);
  assert.equal(own.status,'approved');assert.equal(gate(own.id).status,'approved');assert.equal(gate(own.id).decidedBy,'u-admin');
  assert.equal(waiting.status,'pending');assert.equal(gate(waiting.id).status,'pending');
  // The approved line can go straight to an RFQ.
  await s.act('rfq',admin,{requestLineId:own.items[0].id,supplierIds:['sup-anphat','sup-minhchau']});
 }finally{await db.close()}
});

test('anyone may register, but the account is locked and read-only until an administrator activates it',async()=>{
 const {Accounts}=await import('../src/accounts');const {Auth}=await import('../src/auth');
 const db=await Database.open(':memory:');
 try{
  await new Procurement(db).initialize();
  const accounts=new Accounts(db),auth=new Auth(db,'a-test-secret-that-is-long-enough-123'),admin={id:'u-admin',name:'Admin',role:'admin'};
  assert.deepEqual(await accounts.register({name:'Người Mới',email:'Moi@Example.test',password:'matkhau123'}),{registered:true});
  const created=(await accounts.list(admin)).find(user=>user.email==='moi@example.test')!;
  assert.equal(created.active,false);assert.equal(created.role,'auditor');
  await assert.rejects(()=>auth.login('moi@example.test','matkhau123'));
  await assert.rejects(()=>accounts.register({name:'Trùng',email:'moi@example.test',password:'matkhau123'}),/đã có tài khoản/);
  await assert.rejects(()=>accounts.register({name:'Yếu',email:'yeu@example.test',password:'ngan'}),/Mật khẩu/);
  await accounts.update(admin,created.id,{active:true,role:'buyer'});
  assert.equal((await auth.login('moi@example.test','matkhau123')).user.role,'buyer');
 }finally{await db.close()}
});
