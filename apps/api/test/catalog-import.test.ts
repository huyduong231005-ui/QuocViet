import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Database} from '../src/db';
import {Procurement} from '../src/procurement';
import {readCatalog,writeSampleCatalog} from '../src/catalog-import';

const admin={id:'u-admin',name:'Admin',role:'admin'},auditor={id:'u-auditor',name:'Auditor',role:'auditor'};
const saved={email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD};
/** A real-mode database: one administrator, an empty catalog. */
async function empty(run:(service:Procurement,file:string)=>Promise<void>){
 const directory=await mkdtemp(join(tmpdir(),'catalog-import-')),file=join(directory,'catalog.xlsx');
 process.env.ADMIN_EMAIL='owner@example.test';process.env.ADMIN_PASSWORD='Import@Fixture1';
 const db=await Database.open(':memory:');
 try{const service=new Procurement(db,false);await service.initialize();await writeSampleCatalog(file);await run(service,file)}
 finally{
  await db.close();await rm(directory,{recursive:true,force:true});
  for(const [key,value] of [['ADMIN_EMAIL',saved.email],['ADMIN_PASSWORD',saved.password]] as const)if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
}
const counts=async(service:Procurement)=>{const b=await service.bootstrap();return [b.products.length,b.suppliers.length,b.prices.length]};

test('a preview validates the whole file and writes nothing; a commit loads it once',()=>empty(async(service,file)=>{
 const catalog=await readCatalog(file);
 assert.deepEqual([catalog.products.length,catalog.suppliers.length,catalog.prices.length],[5,3,15]);
 assert.deepEqual(catalog.suppliers[0],{line:2,values:{name:'Văn phòng phẩm Mẫu An Phát',email:'anphat@example.test',phone:'0901234567',reputation:94}});
 await assert.rejects(()=>service.importCatalog(auditor,catalog,true),/quyền/);
 assert.deepEqual(await service.importCatalog(admin,catalog),{committed:false,created:{products:5,suppliers:3,prices:15},errors:[]});
 assert.deepEqual(await counts(service),[0,0,0]);
 assert.deepEqual(await service.importCatalog(admin,catalog,true),{committed:true,created:{products:5,suppliers:3,prices:15},errors:[]});
 assert.deepEqual(await counts(service),[5,3,15]);
 const state=await service.bootstrap();
 // Opening stock went through the ledger and is attributed to the importer.
 assert.equal(state.products.find((p:any)=>p.sku==='VP-A4-80').stock,120);
 assert.deepEqual(state.audit.at(-1).detail,{created:{products:5,suppliers:3,prices:15}});
 // Loading the same file again is refused row by row and changes nothing.
 const again=await service.importCatalog(admin,catalog,true);
 assert.equal(again.committed,false);assert.equal(again.errors.length,23);
 assert.match(again.errors[0],/^Mặt hàng dòng 2: SKU VP-A4-80 đã tồn tại/);
 assert.deepEqual(await counts(service),[5,3,15]);
}));

test('one wrong row rejects the whole file and names the sheet and row',()=>empty(async(service,file)=>{
 const catalog=await readCatalog(file);
 catalog.products[1].values.minStock=-1;
 catalog.products.push({line:7,values:{...catalog.products[0].values}});
 catalog.suppliers[2].values.email='not-an-email';
 catalog.prices[0].values.sku='KHONG-CO';
 catalog.prices[1].values.unitPrice=1.5;
 const result=await service.importCatalog(admin,catalog,true);
 assert.equal(result.committed,false);
 assert.deepEqual(result.errors.map(error=>error.split(':')[0]),
  ['Mặt hàng dòng 3','Mặt hàng dòng 7','Nhà cung cấp dòng 4','Giá tham khảo dòng 2','Giá tham khảo dòng 3',
   // Prices of the rejected product and supplier have nothing to point at.
   ...catalog.prices.filter(p=>p.values.sku==='VP-TN-12A'||p.values.supplier==='Cung ứng Mẫu Thiên Long').filter(p=>p.line>3).map(p=>`Giá tham khảo dòng ${p.line}`)]);
 assert.deepEqual(await counts(service),[0,0,0]);
}));

test('the catalog template downloads and imports over HTTP with a preview step',async()=>{
 const {createApp}=await import('../src/app');const {parseCatalog}=await import('../src/catalog-import');
 const {app,db}=await createApp({dataDir:':memory:',agentEnabled:false});await app.listen(0,'127.0.0.1');const base=await app.getUrl();
 const login=async(role:string)=>(await (await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`${role}@ahp.local`,password:'Demo@12345'})})).json()).token;
 const post=async(token:string,body:unknown)=>{const response=await fetch(base+'/api/catalog/import',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});return {status:response.status,data:await response.json()}};
 try{
  const buyerToken=await login('buyer'),auditorToken=await login('auditor');
  assert.equal((await fetch(base+'/api/catalog/template')).status,401);
  const template=await fetch(base+'/api/catalog/template',{headers:{Authorization:'Bearer '+auditorToken}});
  assert.match(template.headers.get('Content-Type')!,/spreadsheetml/);
  const bytes=Buffer.from(await template.arrayBuffer());
  assert.equal((await parseCatalog(bytes)).prices.length,15);
  // The demo database already has the template's SKUs: the preview names each clash and offers nothing to commit.
  const clash=await post(buyerToken,{fileBase64:bytes.toString('base64')});
  assert.equal(clash.data.committed,false);assert.equal(clash.data.errors.length,5);
  assert.match(clash.data.errors[0],/^Mặt hàng dòng 2: SKU VP-A4-80 đã tồn tại/);
  // The same workbook with new SKUs, as a user would edit it.
  const ExcelJS=(await import('exceljs')).default,workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes as any);
  for(const name of ['Mặt hàng','Giá tham khảo'])workbook.getWorksheet(name)!.eachRow((row,line)=>{if(line>1)row.getCell(1).value=`MOI-${row.getCell(1).value}`});
  const fileBase64=Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
  assert.equal((await post(auditorToken,{fileBase64,commit:true})).status,403);
  for(const body of [{},{fileBase64:''},{fileBase64:Buffer.from('not a workbook').toString('base64')}])assert.equal((await post(buyerToken,body)).status,400);
  const preview=await post(buyerToken,{fileBase64});
  assert.deepEqual(preview.data,{committed:false,created:{products:5,suppliers:3,prices:15},errors:[]});
  assert.equal((await db.transaction(repo=>repo.list('products'),{readOnly:true})).length,5);
  const committed=await post(buyerToken,{fileBase64,commit:true});
  assert.equal(committed.data.committed,true);
  assert.equal((await db.transaction(repo=>repo.list('products'),{readOnly:true})).length,10);
  const again=await post(buyerToken,{fileBase64,commit:true});
  assert.equal(again.status,201);assert.equal(again.data.committed,false);assert.equal(again.data.errors.length,23);
 }finally{await app.close();await db.close()}
});
