import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../src/app';
import {Runtime} from '../src/controller';

const root=resolve(__dirname,'../../..'),python=resolve(root,process.platform==='win32'?'services/agent/.venv/Scripts/python.exe':'services/agent/.venv/bin/python');
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

test('real Python service returns an AI draft over HTTP; confirmation alone writes a quote',{
 skip:existsSync(python)?false:'Install the Agent Python environment to run HTTP integration',timeout:90000,
},async()=>{
 let modelCalls=0;
 const model=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw);modelCalls++;
  assert.equal(body.tools[0].function.strict,true);
  if(body.messages[1].content.includes('API-FAIL')){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'fixture outage'}));return}
  const fields={quantity:{value:15,evidence:'Số lượng: 15 ram'},unitPrice:{value:68000,evidence:'Đơn giá: 68.000 VND'},deliveryDays:{value:3,evidence:'Giao hàng: 3 ngày'},vat:{value:8,evidence:'VAT: 8%'},validUntil:{value:'2099-12-31',evidence:'Hiệu lực đến: 31/12/2099'},currency:{value:'VND',evidence:'VND'},qualityScore:null};
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({usage:{total_tokens:86},choices:[{message:{tool_calls:[{function:{name:'extract_quotation',arguments:JSON.stringify(fields)}}]}}]}));
 });
 await new Promise<void>(resolve=>model.listen(0,'127.0.0.1',resolve));
 const modelPort=(model.address() as {port:number}).port;
 const reservation=createServer();await new Promise<void>(resolve=>reservation.listen(0,'127.0.0.1',resolve));
 const port=(reservation.address() as {port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
 const agentUrl=`http://127.0.0.1:${port}`,key='fixture-agent-key';
 const dataRoot=resolve(root,'.data');await mkdir(dataRoot,{recursive:true});
 const configDirectory=await mkdtemp(join(dataRoot,'agent-config-test-'));
 const configFile=join(configDirectory,'.env');await writeFile(configFile,'DEMO_MODE=true\n');
 const child=spawn(python,['-m','uvicorn','app:app','--app-dir',resolve(root,'services/agent'),'--host','127.0.0.1','--port',String(port)],{
  cwd:root,windowsHide:true,env:{...process.env,AGENT_CONFIG_FILE:configFile,AGENT_API_KEY:key,AGENT_ENABLED:'false',DEMO_MODE:'true',LLM_API_KEY:'fixture-model-key',LLM_BASE_URL:`http://127.0.0.1:${modelPort}/v1`,LLM_MODEL:'fixture-model'},
 });
 let logs='';child.stderr.on('data',chunk=>{logs=(logs+String(chunk)).slice(-3000)});child.stdout.resume();
 let application:Awaited<ReturnType<typeof createApp>>|undefined;
 try{
  let ready=false;
  for(let attempt=0;attempt<100;attempt++){
   if(child.exitCode!==null||child.signalCode!==null)throw new Error(`Python exited before readiness: ${logs}`);
   try{if((await fetch(agentUrl+'/health',{signal:AbortSignal.timeout(500)})).ok){ready=true;break}}catch{}
   await delay(100);
  }
  assert.equal(ready,true,logs);
  application=await createApp({dataDir:':memory:',agentEnabled:false,agentExtractionEnabled:true,agentUrl,agentKey:key});
  const {app,service}=application;await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api';
  const call=async(path:string,body?:unknown,token?:string)=>{
   const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   return {status:response.status,data:await response.json() as any};
  };
  const login=async(role:string)=>(await call('/auth/login',{email:role+'@ahp.local',password:'Demo@12345'})).data.token as string;
  const buyer=await login('buyer'),manager=await login('manager'),auditor=await login('auditor'),admin=await login('admin');
  assert.equal((await call('/agent/status')).status,401);
  const status=(await call('/agent/status',undefined,buyer)).data;
  assert.deepEqual(status,{enabled:false,extractionEnabled:true,reachable:true,llmConfigured:true,ocrAvailable:status.ocrAvailable,model:'fixture-model',provider:'openai',keyCount:1});
  assert.equal(JSON.stringify(status).includes(key),false);
  const filed=(await call('/requests',{reason:'Agent integration fixture',items:[{productId:'pro-paper',quantity:15}]},buyer)).data;
  const approval=(await service.bootstrap()).approvals.find((a:any)=>a.requestId===filed.id);
  assert.equal((await call(`/approvals/${approval.id}/decide`,{approved:true},manager)).status,201);
  const rfq=(await call('/rfqs',{requestLineId:filed.items[0].id,supplierIds:['sup-anphat','sup-minhchau']},buyer)).data;
  const input={rfqId:rfq.id,supplierId:'sup-anphat',text:'Báo giá giấy: Số lượng: 15 ram; Đơn giá: 68.000 VND; Giao hàng: 3 ngày; VAT: 8%; Hiệu lực đến: 31/12/2099.'};
  for(const token of [manager,auditor])assert.equal((await call('/quotations/extract',input,token)).status,403);
  assert.equal((await call('/quotations/extract',{...input,supplierId:'sup-thienlong'},buyer)).status,400);
  assert.equal(modelCalls,0,'bad invitations and unauthorized roles never call the model');
  app.get(Runtime).agentKey='wrong-fixture-key';
  assert.equal((await call('/quotations/extract',input,buyer)).status,503,'upstream credentials must not invalidate the user session');
  app.get(Runtime).agentKey=key;
  const extracted=await call('/quotations/extract',input,buyer);
  assert.equal(extracted.status,201);assert.equal(extracted.data.llmStatus,'used');assert.equal(extracted.data.tokensUsed,86);
  assert.equal(extracted.data.fieldSources.quantity,'model');assert.equal(extracted.data.evidence.unitPrice,'Đơn giá: 68.000 VND');
  assert.deepEqual(extracted.data.quotation,{quantity:15,unitPrice:68000,deliveryDays:3,vat:8,currency:'VND',validUntil:'2099-12-31',rfqId:rfq.id,supplierId:'sup-anphat'});
  assert.equal((await service.bootstrap()).quotations.length,0,'extracting a draft writes no quotation');
  const pdf=await readFile(resolve(root,'services/agent/fixtures/demo-quotation.pdf'));
  const document=await call('/quotations/extract',{rfqId:rfq.id,supplierId:'sup-anphat',fileBase64:pdf.toString('base64'),mimeType:'application/pdf'},buyer);
  assert.equal(document.status,201);assert.equal(document.data.quotation.quantity,15);assert.equal(document.data.quotation.unitPrice,68000);
  assert.equal(document.data.quotation.qualityScore,undefined);assert.equal((await service.bootstrap()).quotations.length,0);
  assert.equal((await call('/quotations',extracted.data.quotation,buyer)).status,400,'a missing quality score needs human input');
  assert.equal((await call('/quotations',{...extracted.data.quotation,qualityScore:90,source:'Confirmed fixture draft'},buyer)).status,201);
  assert.equal((await service.bootstrap()).quotations.length,1);
  const fallback=await call('/quotations/extract',{...input,text:'Số lượng: 15\nAPI-FAIL'},buyer);
  assert.equal(fallback.status,201);assert.equal(fallback.data.llmStatus,'failed');assert.equal(fallback.data.quotation.quantity,15);
  assert.equal((await call('/quotations/extract',{rfqId:rfq.id,supplierId:'sup-anphat',fileBase64:'@@@',mimeType:'application/pdf'},buyer)).status,400);
  assert.equal((await call('/agent/runs',{productId:'pro-paper',quantity:15},buyer)).status,403);
  const tool=await fetch(base+'/agent/tools/detect_need',{method:'POST',headers:{'Content-Type':'application/json','X-Agent-Key':key},body:'{}'});
  assert.equal(tool.status,403);
  const geminiKeys=['fixture.gemini=one','fixture+gemini/two'];
  assert.equal((await call('/agent/config/gemini',{keys:geminiKeys})).status,401);
  for(const token of [buyer,manager,auditor])assert.equal((await call('/agent/config/gemini',{keys:geminiKeys},token)).status,403);
  const configured=await call('/agent/config/gemini',{keys:geminiKeys},admin);
  assert.equal(configured.status,201);
  assert.deepEqual(configured.data,{configured:true,provider:'gemini',model:'gemini-3.5-flash-lite',keyCount:2});
  assert.equal(JSON.stringify(configured.data).includes(geminiKeys[0]),false);
  const geminiStatus=(await call('/agent/status',undefined,buyer)).data;
  assert.equal(geminiStatus.provider,'gemini');assert.equal(geminiStatus.keyCount,2);
  assert.equal((await readFile(configFile,'utf8')).includes('GEMINI_API_KEYS='+geminiKeys.join(',')),true);
  child.kill();await once(child,'exit');
  assert.equal((await call('/agent/status',undefined,buyer)).data.reachable,false);
  assert.equal((await call('/quotations/extract',input,buyer)).status,503);
  assert.equal((await service.bootstrap()).quotations.length,1,'outages do not add or change records');
 }finally{
  if(child.exitCode===null&&child.signalCode===null){child.kill();await once(child,'exit')}
  if(application){await application.app.close();await application.db.close()}
  await new Promise<void>(resolve=>model.close(()=>resolve()));
  const scoped=resolve(configDirectory);
  assert.ok(scoped.toLowerCase().startsWith((dataRoot+sep).toLowerCase()),'cleanup must stay inside workspace .data');
  await rm(scoped,{recursive:true,force:true});
 }
});
