import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import {existsSync} from 'node:fs';

const STATUS:Record<string,string>={ordered:'Đã đặt',partially_received:'Nhận một phần',received:'Đã nhận đủ',draft:'Bản nháp',pending_approval:'Chờ duyệt',approved:'Đã duyệt',rejected:'Từ chối',stale:'Hết hiệu lực',OPENING:'Tồn đầu',RECEIPT:'Nhập hàng'};
const label=(value:string)=>STATUS[value]??value;
const shortId=(id?:string)=>id?id.slice(0,8).toUpperCase():'';
const when=(value?:string)=>value?new Date(value).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'short'}):'';
/** Names and notes are typed by users. A cell starting with one of these would
 * be run as a formula by a spreadsheet, so it is stored as plain text instead. */
export const safeCell=(value:unknown)=>typeof value==='string'&&/^[=+\-@\t\r]/.test(value)?`'${value}`:value??'';

type Column=[header:string,value:(row:any)=>unknown,width?:number];
/** Reports name things the way people know them: product and supplier names,
 * units and document numbers, never bare internal IDs. */
function sections(data:any):[sheet:string,rows:any[],columns:Column[]][] {
 const product=new Map<string,any>(data.products.map((p:any)=>[p.id,p])),supplier=new Map<string,any>(data.suppliers.map((s:any)=>[s.id,s])),order=new Map<string,any>(data.orders.map((o:any)=>[o.id,o]));
 const productName=(id:string)=>product.get(id)?.name??id,supplierName=(id:string)=>supplier.get(id)?.name??id;
 return [
  ['Tồn kho',data.inventory,[['SKU',r=>r.sku,16],['Mặt hàng',r=>r.name,36],['Đơn vị',r=>r.unit,10],['Tồn kho',r=>r.stock],['Tồn tối thiểu',r=>r.minStock],['Dự báo',r=>r.forecast],['Cần bổ sung',r=>r.reorderQuantity]]],
  // One row per PO line and per received line: a PO may hold several products.
  ['Đơn mua',data.orders.flatMap((o:any)=>o.items.map((line:any)=>({...line,order:o}))),[['Số PO',r=>shortId(r.order.id),12],['Dòng',r=>r.lineNo,8],['Ngày tạo',r=>when(r.order.createdAt),18],['Nhà cung cấp',r=>supplierName(r.order.supplierId),34],['SKU',r=>r.productSku,16],['Mặt hàng',r=>r.productName,34],['Đơn vị',r=>r.unit,10],['SL đặt',r=>r.quantity],['SL đã nhận',r=>r.receivedQuantity],['SL đạt',r=>r.acceptedQuantity],['Đơn giá (VND)',r=>r.unitPrice,16],['VAT %',r=>r.vat],['Thành tiền đã VAT (VND)',r=>r.total,24],['Trạng thái PO',r=>label(r.order.status),16]]],
  ['Phiếu nhận',data.receipts.flatMap((receipt:any)=>receipt.items.map((item:any)=>({...item,receipt}))),[['Số PO',r=>shortId(r.receipt.orderId),12],['Ngày nhận',r=>when(r.receipt.receivedAt),18],['Nhà cung cấp',r=>supplierName(order.get(r.receipt.orderId)?.supplierId),34],['Mặt hàng',r=>productName(r.productId),34],['SL giao',r=>r.quantity],['SL đạt',r=>r.acceptedQuantity],['Ghi chú',r=>r.receipt.notes,40]]],
  ['Đánh giá NCC',data.evaluations,[['Số PO',r=>shortId(r.orderId),12],['Nhà cung cấp',r=>supplierName(r.supplierId),34],['Chất lượng',r=>r.qualityScore],['Giao hàng',r=>r.deliveryScore],['Dịch vụ',r=>r.serviceScore],['Tổng hợp',r=>r.overallScore],['Ghi chú',r=>r.notes,40]]],
  ['Biến động kho',data.movements??[],[['Thời điểm',r=>when(r.createdAt),18],['SKU',r=>r.sku,16],['Mặt hàng',r=>r.productName,34],['Loại',r=>label(r.kind),12],['Thay đổi',r=>r.delta],['Tồn sau',r=>r.balanceAfter],['Đơn vị',r=>r.unit,10],['Số PO',r=>shortId(r.orderId),12],['Nhà cung cấp',r=>r.supplierName,34],['Người thực hiện',r=>r.actorName,24]]],
  ['Lịch sử mua',data.history,[['Tháng',r=>r.month,10],['Mặt hàng',r=>productName(r.productId),34],['Nhà cung cấp',r=>supplierName(r.supplierId),34],['Số lượng',r=>r.quantity],['Đơn giá (VND)',r=>r.unitPrice,16],['Đúng hạn',r=>r.onTime?'Có':'Không'],['Chất lượng',r=>r.qualityScore],['Dữ liệu mô phỏng',r=>r.synthetic?'Có':'Không',18]]],
 ];
}
export async function buildExcel(data:any){
 const workbook=new ExcelJS.Workbook();workbook.creator='ProcureIQ';
 for(const [name,rows,columns] of sections(data)){
  const sheet=workbook.addWorksheet(name);
  sheet.columns=columns.map(([header,,width])=>({header,width:width??14}));
  for(const row of rows)sheet.addRow(columns.map(([,value])=>safeCell(value(row))));
  sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF0F766E'}};
  sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:'A1',to:{row:1,column:columns.length}};
 }
 return Buffer.from(await workbook.xlsx.writeBuffer());
}
const vnd=(value:number)=>`${value.toLocaleString('vi-VN')} VND`;
type Line=(text:string,size?:number)=>void;
function compose(write:(line:Line)=>void):Promise<Buffer>{return new Promise((resolve,reject)=>{
 const document=new PDFDocument({size:'A4',margin:44}),chunks:Buffer[]=[];document.on('data',c=>chunks.push(c));document.on('end',()=>resolve(Buffer.concat(chunks)));document.on('error',reject);
 const font=['C:/Windows/Fonts/arial.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find(existsSync);if(font)document.font(font);
 write((text,size=10)=>{if(document.y>745)document.addPage();document.fontSize(size).fillColor('#182c36').text(text,{width:507});document.moveDown(.45)});
 document.end();
})}
/** The purchase order as sent to the supplier: one line per product, totals with VAT. */
export function buildOrderPdf(order:any,supplier:any,sender:string):Promise<Buffer>{return compose(line=>{
 line(`ĐƠN ĐẶT HÀNG ${shortId(order.id)}`,18);line(`Bên mua: ${sender}`);line(`Nhà cung cấp: ${supplier.name}`);line(`Ngày lập: ${when(order.createdAt)}`);
 line('CHI TIẾT',14);
 for(const item of order.items)line(`${item.lineNo??''}. ${item.productName} (${item.productSku})\n   ${item.quantity} ${item.unit} × ${vnd(item.unitPrice)}, VAT ${item.vat}% = ${vnd(item.total)} | giao trong ${item.deliveryDays} ngày`);
 line(`Tổng cộng đã gồm VAT: ${vnd(order.total)}`,12);
})}
export function buildPdf(data:any):Promise<Buffer>{return compose(line=>{
 const product=new Map<string,any>(data.products.map((p:any)=>[p.id,p])),supplier=new Map<string,any>(data.suppliers.map((s:any)=>[s.id,s])),rfq=new Map<string,any>(data.rfqs.map((r:any)=>[r.id,r]));
 line('BÁO CÁO NHẬP HÀNG VÀ LỰA CHỌN NHÀ CUNG CẤP',18);line(`Ngày xuất: ${new Date().toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}`);if(data.demoMode)line('Dữ liệu demo; lịch sử 24 tháng là dữ liệu mô phỏng.');
 line(`Mặt hàng: ${data.products.length} | Nhà cung cấp: ${data.suppliers.length} | Đơn mua: ${data.orders.length}`,12);line('TỒN KHO VÀ DỰ BÁO',14);
 for(const p of data.inventory)line(`${p.sku} — ${p.name}\nTồn: ${p.stock} ${p.unit} | Tối thiểu: ${p.minStock} | Dự báo: ${p.forecast} | Đề nghị nhập: ${p.reorderQuantity}`);
 line('PHIÊN AHP',14);
 for(const s of data.ahpSessions){
  const item=product.get(rfq.get(s.rfqId)?.productId);
  line(`${item?`${item.name} (${rfq.get(s.rfqId).quantity} ${item.unit})`:`RFQ ${shortId(s.rfqId)}`} | CR ${s.cr.toFixed(4)} | ${label(s.status)}`);
  for(const r of s.ranking)line(`   ${r.supplierName}: ${(r.score*100).toFixed(2)}%`);
 }
 if(data.ahpSessions.length)line('Monte Carlo thể hiện độ bền thứ hạng dưới giả định nhiễu, không phải xác suất nhà cung cấp đúng tuyệt đối.');
 line('ĐƠN MUA',14);
 for(const o of data.orders){
  line(`PO ${shortId(o.id)} — ${supplier.get(o.supplierId)?.name??o.supplierId} — ${when(o.createdAt)} — ${label(o.status)}`);
  for(const item of o.items)line(`   ${item.productName}: ${item.quantity} ${item.unit} × ${vnd(item.unitPrice)}, VAT ${item.vat}% = ${vnd(item.total)} | đã nhận ${item.receivedQuantity}, đạt ${item.acceptedQuantity}`);
  if(o.items.length>1)line(`   Tổng đã VAT: ${vnd(o.total)}`);
 }
})}
