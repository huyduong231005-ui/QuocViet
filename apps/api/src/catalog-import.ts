import ExcelJS from 'exceljs';
import {readFile,writeFile} from 'node:fs/promises';

/** One spreadsheet row: its Excel row number (for error messages) and its cells
 * keyed by API field name. Validation happens in the service, not here. */
export interface ImportRow {line:number;values:Record<string,unknown>}
export interface CatalogFile {products:ImportRow[];suppliers:ImportRow[];prices:ImportRow[]}

const SHEETS={
 products:{name:'Mặt hàng',columns:{'SKU':'sku','Tên':'name','Đơn vị':'unit','Tồn tối thiểu':'minStock','Tồn đầu':'stock'}},
 suppliers:{name:'Nhà cung cấp',columns:{'Tên':'name','Email':'email','Điện thoại':'phone','Uy tín':'reputation'}},
 prices:{name:'Giá tham khảo',columns:{'SKU':'sku','Nhà cung cấp':'supplier','Đơn giá':'unitPrice','Số ngày giao':'deliveryDays','Điểm chất lượng':'qualityScore'}},
} as const;
// Excel stores a phone number or a numeric SKU as a number; these stay text.
const TEXT_FIELDS=new Set(['sku','name','unit','email','phone','supplier']);

function plain(value:ExcelJS.CellValue):unknown {
 if(value===null||value===undefined)return undefined;
 if(typeof value==='object'&&!(value instanceof Date)){
  const cell=value as any;
  if(Array.isArray(cell.richText))return cell.richText.map((part:any)=>part.text).join('');
  if('result' in cell)return plain(cell.result);   // formula
  if('text' in cell)return plain(cell.text);       // hyperlink, e.g. an email address
  return undefined;
 }
 return value;
}
function sheetRows(workbook:ExcelJS.Workbook,key:keyof typeof SHEETS):ImportRow[] {
 const {name,columns}=SHEETS[key],sheet=workbook.getWorksheet(name);
 if(!sheet)throw new Error(`Thiếu sheet "${name}"`);
 const fields=new Map<number,string>();
 sheet.getRow(1).eachCell((cell,column)=>{const field=(columns as Record<string,string>)[String(plain(cell.value)??'').trim()];if(field)fields.set(column,field)});
 const missing=Object.keys(columns).filter(header=>![...fields.values()].includes((columns as Record<string,string>)[header]));
 if(missing.length)throw new Error(`Sheet "${name}" thiếu cột: ${missing.join(', ')}`);
 const rows:ImportRow[]=[];
 sheet.eachRow((row,line)=>{
  if(line===1)return;
  const values:Record<string,unknown>={};
  for(const [column,field] of fields){
   let value=plain(row.getCell(column).value);
   if(typeof value==='string')value=value.trim()||undefined;
   if(value!==undefined)values[field]=TEXT_FIELDS.has(field)?String(value):value;
  }
  if(Object.keys(values).length)rows.push({line,values});
 });
 return rows;
}
/** Reads an uploaded or on-disk workbook. An unreadable file or a missing sheet
 * or column is reported in words the person who made the file can act on. */
export async function parseCatalog(content:Buffer):Promise<CatalogFile> {
 const workbook=new ExcelJS.Workbook();
 try{await workbook.xlsx.load(content as any)}catch{throw new Error('Không đọc được file. Hãy dùng file Excel .xlsx theo file mẫu.')}
 return {products:sheetRows(workbook,'products'),suppliers:sheetRows(workbook,'suppliers'),prices:sheetRows(workbook,'prices')};
}
export async function readCatalog(path:string):Promise<CatalogFile> {return parseCatalog(await readFile(path))}

/** A small office-supplies catalog for trying the system out. Names, contacts
 * and prices are invented. */
export async function buildSampleCatalog():Promise<Buffer> {
 const products=[['VP-A4-80','Giấy A4 80gsm','ram',200,120],['VP-TN-12A','Mực in 12A','hộp',20,18],['VP-BP-01','Bút bi xanh','hộp',30,48],['VP-FL-A4','Bìa hồ sơ A4','cái',200,350],['VP-TP-48','Băng keo 48mm','cuộn',50,65]] as const;
 const suppliers=[['Văn phòng phẩm Mẫu An Phát','anphat@example.test','0901234567',94],['Thương mại Mẫu Minh Châu','minhchau@example.test','0902345678',89],['Cung ứng Mẫu Thiên Long','thienlong@example.test','0903456789',96]] as const;
 const base=[68000,280000,46000,7000,14000];
 const workbook=new ExcelJS.Workbook();workbook.creator='ProcureIQ';
 const sheet=(key:keyof typeof SHEETS,rows:readonly (readonly unknown[])[])=>{
  const target=workbook.addWorksheet(SHEETS[key].name);
  target.addRow(Object.keys(SHEETS[key].columns));target.getRow(1).font={bold:true};
  for(const row of rows)target.addRow([...row]);
  target.columns.forEach(column=>{column.width=24});
 };
 sheet('products',products);sheet('suppliers',suppliers);
 sheet('prices',products.flatMap((product,p)=>suppliers.map((supplier,s)=>[product[0],supplier[0],Math.round(base[p]*(1+s*.045)),3-s,92+s*2])));
 return Buffer.from(await workbook.xlsx.writeBuffer());
}
export async function writeSampleCatalog(path:string){await writeFile(path,await buildSampleCatalog())}
