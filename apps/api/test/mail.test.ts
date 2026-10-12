import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Database} from '../src/db';
import {Procurement} from '../src/procurement';
import {Mail,mailerFromEnv} from '../src/mailer';

const buyer={id:'u-buyer',name:'Buyer',role:'buyer',email:'buyer@example.test'},manager={id:'u-manager',name:'Manager',role:'manager'};
const matrix=[[1,2,4,4],[.5,1,2,2],[.25,.5,1,1],[.25,.5,1,1]];

test('real sending is off until an account is configured',()=>{
 assert.equal(mailerFromEnv({}),undefined);assert.equal(mailerFromEnv({SMTP_USER:'a@example.test'}),undefined);
 assert.equal(typeof mailerFromEnv({SMTP_USER:'a@example.test',SMTP_PASSWORD:'x'}),'function');
});

test('RFQ and PO mail is sent, the PO carries its PDF, and a failed PO mail can be retried',async()=>{
 const db=await Database.open(':memory:');
 try{
  const s=new Procurement(db),sent:Mail[]=[];let broken=false;
  s.mailer=async mail=>{if(broken)throw new Error('connection refused');sent.push(mail)};await s.initialize();
  const request=await s.act('request',buyer,{reason:'Giấy cho quý 4',items:[{productId:'pro-paper',quantity:100}]});
  await s.act('decide',manager,{approved:true},(await s.bootstrap()).approvals.find((a:any)=>a.requestId===request.id).id);
  const rfq=await s.act('rfq',buyer,{requestLineId:request.items[0].id,supplierIds:['sup-anphat','sup-minhchau']});
  assert.equal(sent.length,2);assert.match(sent[0].subject,/Yêu cầu báo giá/);assert.equal(sent[0].attachments,undefined);assert.equal(sent[0].sender,'buyer@example.test');
  for(const [supplierId,unitPrice] of [['sup-anphat',70000],['sup-minhchau',72000]] as const)await s.act('quotation',buyer,{rfqId:rfq.id,supplierId,quantity:100,unitPrice,deliveryDays:3,qualityScore:90,vat:8,currency:'VND',validUntil:'2099-12-31'});
  const session=await s.act('ahp',buyer,{rfqId:rfq.id,matrix,iterations:100});
  await s.act('decide',manager,{approved:true,supplierId:'sup-anphat',comment:'Chọn theo đề xuất'},(await s.act('approval2',buyer,{},session.id)).id);
  const order=await s.act('order',buyer,{sessionId:session.id});
  const orderNow=async()=>(await s.bootstrap()).orders.find((o:any)=>o.id===order.id);

  broken=true;
  await assert.rejects(()=>s.act('send',buyer,{},order.id),/Chưa gửi được thư PO/);
  assert.equal((await orderNow()).sentAt,undefined);
  assert.equal((await s.bootstrap()).outbox.find((m:any)=>m.orderId===order.id).status,'failed');

  broken=false;
  const mail=await s.act('send',buyer,{},order.id);
  assert.equal(mail.status,'sent');assert.ok((await orderNow()).sentAt);assert.equal(sent.length,3);
  const [attachment]=sent[2].attachments!;
  assert.match(attachment.filename,/^PO-[0-9A-Z-]{8}\.pdf$/);assert.equal(attachment.content.subarray(0,5).toString(),'%PDF-');

  await s.act('send',buyer,{},order.id);
  assert.equal(sent.length,3,'a sent PO is not mailed twice');
 }finally{await db.close()}
});
