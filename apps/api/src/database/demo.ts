import {randomUUID} from 'node:crypto';
import {Database,RecordData} from '../db';
import {Procurement} from '../procurement';
import {Accounts} from '../accounts';
import {Actor} from '../auth';
import {parseCatalog,buildSampleCatalog} from '../catalog-import';

/** The password of the accounts this command creates. It is public on purpose: it is printed and written in the README. */
export const DEMO_PASSWORD='Demo@12345';
const ROLES:Record<string,string>={buyer:'Nhân viên mua hàng & kho',manager:'Quản lý',auditor:'Kiểm toán'};
const MATRIX=[[1,2,4,4],[.5,1,2,2],[.25,.5,1,1],[.25,.5,1,1]];
const FALLBACK_PRICE=50000;

/** Fills an installation that has no purchase request yet with one small, complete story,
 * so a fresh download shows every screen with something on it: a PO received and evaluated,
 * a two-line PO received in part, and a request waiting for approval. Everything is written
 * through the same service the screens use, so it obeys every rule real work does. Missing
 * role accounts and a missing catalog are created first. Returns lines to print. */
export async function seedDemo(db:Database,demo:boolean):Promise<string[]> {
 const service=new Procurement(db,demo);await service.initialize();
 const users=await db.transaction(repo=>repo.list('users'),{readOnly:true});
 const actor=(user:RecordData):Actor=>({id:user.id,name:user.name,role:user.role,email:user.email});
 const admin=users.find(user=>user.role==='admin'&&user.active!==false);
 if(!admin)throw new Error('No active administrator account; start the application once first');
 if((await service.bootstrap()).requests.length)throw new Error('This database already has purchase requests; the demo story is only for an empty one');

 const people:Record<string,Actor>={admin:actor(admin)},report:string[]=[],accounts=new Accounts(db);
 for(const [role,name] of Object.entries(ROLES)){
  const existing=users.find(user=>user.role===role&&user.active!==false);
  if(existing){people[role]=actor(existing);continue}
  const created=await accounts.create(people.admin,{name,email:`${role}@demo.local`,role,password:DEMO_PASSWORD});
  people[role]={id:created.id,name:created.name,role:created.role,email:created.email};
  report.push(`account created: ${created.email} (password ${DEMO_PASSWORD})`);
 }
 let data=await service.bootstrap();
 if(!data.products.length){
  const result=await service.importCatalog(people.admin,await parseCatalog(await buildSampleCatalog()),true);
  if(result.errors.length)throw new Error(`Sample catalog rejected: ${result.errors[0]}`);
  data=await service.bootstrap();
 }
 const suppliers=data.suppliers.filter((s:RecordData)=>s.active).slice(0,3).map((s:RecordData)=>s.id);
 if(data.products.length<3||suppliers.length<2)throw new Error('The catalog needs at least three products and two active suppliers');
 const {buyer,manager}=people;

 const request=async(reason:string,items:{productId:string;quantity:number}[],approve=true)=>{
  const filed=await service.act('request',buyer,{reason,items});
  if(approve){const gate=(await service.bootstrap()).approvals.find((a:RecordData)=>a.requestId===filed.id&&a.gate===1);await service.act('decide',manager,{approved:true,comment:'Đồng ý'},gate.id)}
  return filed;
 };
 /** One approved line taken through RFQ, quotations and AHP to an approved choice of `supplierId` (the leader when omitted). */
 const choose=async(line:RecordData,supplierId?:string)=>{
  const rfq=await service.act('rfq',buyer,{requestLineId:line.id,supplierIds:suppliers});
  const base=data.prices.find((p:RecordData)=>p.productId===line.productId)?.unitPrice??FALLBACK_PRICE;
  for(const [i,id] of suppliers.entries())await service.act('quotation',buyer,{rfqId:rfq.id,supplierId:id,quantity:line.quantity,unitPrice:Math.round(base*(1+i*0.04)/500)*500,deliveryDays:4-i,qualityScore:90+i*2,vat:8,currency:'VND',validUntil:'2099-12-31',source:'Dữ liệu demo'});
  const session=await service.act('ahp',buyer,{rfqId:rfq.id,criteria:data.criteria,matrix:MATRIX,iterations:500,seed:42});
  const approval=await service.act('approval2',buyer,{},session.id);
  await service.act('decide',manager,{approved:true,supplierId:supplierId??session.ranking[0].supplierId,comment:supplierId?'Gộp một nhà cung cấp cho cả đơn':'Chọn theo xếp hạng AHP'},approval.id);
  return session;
 };
 const receive=(order:RecordData,items:{orderLineId:string;quantity:number;acceptedQuantity:number}[])=>service.act('receipt',buyer,{orderId:order.id,receivedAt:new Date().toISOString(),idempotencyKey:randomUUID(),notes:'',items});
 const [first,second,third,fourth]=data.products;

 const done=await request('Bổ sung hàng cho quý 4',[{productId:first.id,quantity:100}]);
 const finished=await service.act('order',buyer,{sessionIds:[(await choose(done.items[0])).id]});
 await service.act('send',buyer,{},finished.id);
 await receive(finished,[{orderLineId:finished.items[0].id,quantity:100,acceptedQuantity:98}]);
 await service.act('evaluation',buyer,{orderId:finished.id,qualityScore:90,serviceScore:92,notes:'Giao đúng hẹn'});

 const pair=await request('Bổ sung vật tư cho văn phòng',[{productId:second.id,quantity:10},{productId:third.id,quantity:24}]);
 const sessions=[await choose(pair.items[0],suppliers[0]),await choose(pair.items[1],suppliers[0])];
 const open=await service.act('order',buyer,{sessionIds:sessions.map(session=>session.id)});
 await receive(open,[{orderLineId:open.items[0].id,quantity:6,acceptedQuantity:5}]);

 await request('Dự trữ cho tháng tới',[{productId:(fourth??first).id,quantity:30}],false);
 return [...report,'demo story written: one PO received and evaluated, one two-line PO received in part, one request waiting for approval'];
}
