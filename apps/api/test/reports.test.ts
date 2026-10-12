import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {Database} from '../src/db';
import {Procurement} from '../src/procurement';
import {buildExcel,buildPdf,safeCell} from '../src/reports';

const buyer={id:'u-buyer',name:'Buyer',role:'buyer'},manager={id:'u-manager',name:'Manager',role:'manager'},receiver=buyer;
const matrix=[[1,2,4,4],[.5,1,2,2],[.25,.5,1,1],[.25,.5,1,1]];

test('stock ledger and Excel report name products, suppliers and documents instead of internal IDs',async()=>{
 const db=await Database.open(':memory:');const s=new Procurement(db);await s.initialize();
 try{
  const created=await s.act('catalog:suppliers:create',buyer,{name:'=HYPERLINK("http://x")',email:'formula@example.test'});
  const request=await s.act('request',buyer,{productId:'pro-paper',quantity:10,reason:'Báo cáo'});
  await s.act('decide',manager,{approved:true},(await s.bootstrap()).approvals.find((a:any)=>a.requestId===request.id).id);
  const rfq=await s.act('rfq',buyer,{requestId:request.id,supplierIds:['sup-anphat',created.id]});
  await s.act('quotation',buyer,{rfqId:rfq.id,supplierId:'sup-anphat',quantity:10,unitPrice:70000,deliveryDays:3,qualityScore:90,vat:8,currency:'VND',validUntil:'2099-12-31'});
  await s.act('quotation',buyer,{rfqId:rfq.id,supplierId:created.id,quantity:10,unitPrice:60000,deliveryDays:1,qualityScore:99,vat:8,currency:'VND',validUntil:'2099-12-31'});
  const session=await s.act('ahp',buyer,{rfqId:rfq.id,matrix,iterations:100});
  await s.act('decide',manager,{approved:true,supplierId:'sup-anphat',comment:'Chọn An Phát'},(await s.act('approval2',buyer,{},session.id)).id);
  const po=await s.act('order',buyer,{sessionId:session.id});
  await s.act('receipt',receiver,{orderId:po.id,quantity:4,acceptedQuantity:3,receivedAt:new Date().toISOString(),idempotencyKey:'report-1',notes:'-1 ram hỏng'});
  const data=await s.bootstrap();

  // Newest first; each row carries the balance it left and what caused it.
  const paper=data.movements.filter((m:any)=>m.productId==='pro-paper');
  assert.deepEqual(paper.map((m:any)=>[m.kind,m.delta,m.balanceAfter,m.actorName,m.supplierName,m.orderId]),
   [['RECEIPT',3,123,'Nhân viên mua hàng & kho','Văn phòng phẩm An Phát',po.id],['OPENING',120,120,'Hệ thống',undefined,undefined]]);
  assert.equal(data.movements.length,6);

  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await buildExcel(data) as any);
  const table=(name:string)=>{const rows:any[][]=[];workbook.getWorksheet(name)!.eachRow(row=>rows.push((row.values as any[]).slice(1)));return rows};
  assert.deepEqual(workbook.worksheets.map(sheet=>sheet.name),['Tồn kho','Đơn mua','Phiếu nhận','Đánh giá NCC','Biến động kho','Lịch sử mua']);
  const [header,order]=table('Đơn mua');
  assert.deepEqual(header,['Số PO','Dòng','Ngày tạo','Nhà cung cấp','SKU','Mặt hàng','Đơn vị','SL đặt','SL đã nhận','SL đạt','Đơn giá (VND)','VAT %','Thành tiền đã VAT (VND)','Trạng thái PO']);
  assert.deepEqual([order[0],order[1],order[3],order[4],order[5],order[6],order[7],order[8],order[9],order[12],order[13]],
   [po.id.slice(0,8).toUpperCase(),1,'Văn phòng phẩm An Phát','VP-A4-80','Giấy A4 Double A 80gsm','ram',10,4,3,756000,'Nhận một phần']);
  assert.deepEqual(table('Phiếu nhận')[1].slice(2),['Văn phòng phẩm An Phát','Giấy A4 Double A 80gsm',4,3,"'-1 ram hỏng"]);
  assert.equal(table('Biến động kho')[1][3],'Nhập hàng');
  // No sheet leaks an internal UUID in full.
  for(const sheet of workbook.worksheets)sheet.eachRow(row=>row.eachCell(cell=>assert.doesNotMatch(String(cell.value),/[0-9a-f]{8}-[0-9a-f]{4}-/,`${sheet.name}: ${cell.value}`)));
  const pdf=await buildPdf(data);assert.equal(pdf.subarray(0,4).toString(),'%PDF');assert.ok(pdf.byteLength>2000);
 }finally{await db.close()}
});

test('cells that a spreadsheet would run as formulas are stored as text',()=>{
 for(const value of ['=1+1','+84901234567','-5','@SUM(A1)','\tx'])assert.equal(safeCell(value),`'${value}`);
 assert.equal(safeCell('Giấy A4'),'Giấy A4');assert.equal(safeCell(-5),-5);assert.equal(safeCell(undefined),'');
});
