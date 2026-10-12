import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../src/app';
test('REST authentication validates four roles and protected catalog writes and agent key',async()=>{
 const {app,db}=await createApp({dataDir:':memory:',agentEnabled:false});await app.listen(0,'127.0.0.1');const base=await app.getUrl();
 const call=async(path:string,method='GET',body?:any,token?:string)=>{const response=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()}};
 try {
  const health=await call('/health');assert.equal(health.status,200);assert.equal(health.data.agentEnabled,false);assert.equal((await call('/bootstrap')).status,401);assert.equal((await call('/auth/login','POST',{email:'buyer@ahp.local',password:'wrong'})).status,401);
  for(const role of ['admin','buyer','manager','auditor']){const login=await call('/auth/login','POST',{email:role+'@ahp.local',password:'Demo@12345'});assert.equal(login.status,201);assert.equal(login.data.user.role,role);assert.equal((await call('/bootstrap','GET',undefined,login.data.token)).status,200);const create=await call('/products','POST',{sku:'TEST-'+role,name:'Test',unit:'cái',minStock:10,stock:0},login.data.token);assert.equal(create.status,['admin','buyer'].includes(role)?201:403)}
  assert.equal((await call('/agent/tools/detect_need','POST',{runId:'fake'})).status,401);
  const login=await call('/auth/login','POST',{email:'buyer@ahp.local',password:'Demo@12345'});
  // The combined role reaches receipt validation; it is no longer refused by authorization.
  assert.equal((await call('/receipts','POST',{},login.data.token)).status,400);
  for(const role of ['manager','auditor']){
   const other=await call('/auth/login','POST',{email:role+'@ahp.local',password:'Demo@12345'});
   assert.equal((await call('/receipts','POST',{},other.data.token)).status,403);
  }
  assert.equal((await call('/agent/runs','POST',{productId:'pro-paper',quantity:100},login.data.token)).status,403);
  assert.equal((await call('/quotations/extract','POST',{text:'demo'},login.data.token)).status,403);
  const disabledTool=await fetch(base+'/api/agent/tools/detect_need',{method:'POST',headers:{'Content-Type':'application/json','X-Agent-Key':'local-demo-agent-key'},body:JSON.stringify({runId:'fake'})});assert.equal(disabledTool.status,403);
  assert.equal((await call('/bootstrap','GET',undefined,login.data.token)).data.agentRuns.length,0);
  const invalid=await call('/requests','POST',{productId:'pro-paper',quantity:'100',reason:'bad'},login.data.token);assert.equal(invalid.status,400);
  for(const path of ['/reports/excel','/reports/pdf']){const response=await fetch(base+'/api'+path,{headers:{Authorization:'Bearer '+login.data.token}});assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.byteLength>1000);if(path.endsWith('pdf')){assert.match(response.headers.get('Content-Type')!,/application\/pdf/);assert.equal(bytes.subarray(0,4).toString(),'%PDF')}else{assert.match(response.headers.get('Content-Type')!,/spreadsheetml/);assert.equal(bytes.subarray(0,2).toString(),'PK')}}
 }finally{await app.close();await db.close()}
});
