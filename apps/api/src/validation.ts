import {z} from 'zod';
import {DomainError} from './errors';
const num=z.number().finite(),positive=num.positive(),text=z.string().trim().min(1).max(500),id=z.string().min(1).max(100),score=num.min(1).max(100);
const STOCK_LIMIT=1e9;
export const productSchema=z.object({sku:text,name:text,unit:text,minStock:num.int().nonnegative().max(STOCK_LIMIT),stock:num.int().nonnegative().max(STOCK_LIMIT).default(0)});
export const supplierSchema=z.object({name:text,email:z.email().max(254),phone:z.string().max(40).default(''),reputation:score.default(80),active:z.boolean().default(true)});
export const priceSchema=z.object({productId:id,supplierId:id,unitPrice:positive.int().max(1e10),deliveryDays:positive.int().max(365),qualityScore:score});
const LINES=50;
export const requestSchema=z.object({reason:text,items:z.array(z.object({productId:id,quantity:positive.int().max(1e7)})).min(1).max(LINES)});
export const rfqSchema=z.object({requestId:id.optional(),requestLineId:id.optional(),supplierIds:z.array(id).min(2).max(10)});
export const orderSchema=z.object({sessionIds:z.array(id).min(1).max(LINES)});
export const quotationSchema=z.object({rfqId:id,supplierId:id,quantity:positive.int().max(1e7),unitPrice:positive.int().max(1e10),deliveryDays:positive.int().max(365),qualityScore:score,vat:num.min(0).max(100).default(0),currency:z.literal('VND').default('VND'),validUntil:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),source:z.string().max(10000).default('manual')});
export const receiptSchema=z.object({orderId:id,quantity:positive.int(),acceptedQuantity:num.int().nonnegative(),receivedAt:z.iso.datetime({offset:true}),idempotencyKey:id,notes:z.string().max(2000).default('')});
export const receiptItemsSchema=z.object({orderId:id,receivedAt:z.iso.datetime({offset:true}),idempotencyKey:id,notes:z.string().max(2000).default(''),items:z.array(z.object({orderLineId:id,quantity:positive.int(),acceptedQuantity:num.int().nonnegative()})).min(1).max(LINES)});
export const evaluationSchema=z.object({orderId:id,qualityScore:score,serviceScore:score,notes:z.string().max(2000).default('')});
const role=z.enum(['admin','buyer','manager','warehouse','auditor'],{message:'Vai trò không hợp lệ'});
const password=z.string().min(8,'Mật khẩu cần ít nhất 8 ký tự').max(256,'Mật khẩu quá dài').regex(/\p{L}/u,'Mật khẩu cần có chữ cái').regex(/\d/,'Mật khẩu cần có chữ số');
const email=z.email('Email không hợp lệ').max(254).transform(value=>value.toLowerCase());
const personName=z.string('Nhập họ tên').trim().min(1,'Nhập họ tên').max(500,'Họ tên quá dài');
export const accountCreateSchema=z.object({name:personName,email,role,password});
export const registerSchema=z.object({name:personName,email,password});
export const accountUpdateSchema=z.object({name:personName.optional(),role:role.optional(),active:z.boolean().optional()});
export const passwordResetSchema=z.object({password});
export const passwordChangeSchema=z.object({currentPassword:z.string().max(256),newPassword:password});
// Query strings arrive as text; an empty filter means "no filter".
const optional=(max:number)=>z.string().trim().max(max).optional().transform(value=>value||undefined);
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'Ngày phải có dạng YYYY-MM-DD').optional().or(z.literal('').transform(()=>undefined));
const paging={page:z.coerce.number('Số trang không hợp lệ').int().min(1).max(100000).default(1),pageSize:z.coerce.number('Cỡ trang không hợp lệ').int().min(1,'Cỡ trang từ 1 đến 100').max(100,'Cỡ trang từ 1 đến 100').default(20),search:optional(100)};
export const auditQuerySchema=z.object({...paging,action:optional(100),entityType:optional(100),from:day,to:day});
export const movementQuerySchema=z.object({...paging,productId:optional(100),kind:z.enum(['OPENING','RECEIPT'],{message:'Loại biến động không hợp lệ'}).optional().or(z.literal('').transform(()=>undefined))});
export const documentQuerySchema=z.object({...paging,status:optional(30),gate:z.coerce.number().int().min(1).max(2).optional().or(z.literal('').transform(()=>undefined)),rfqId:optional(100),orderId:optional(100)});
export const decisionSchema=z.object({approved:z.boolean(),comment:z.string().max(2000).default(''),supplierId:id.optional()});
const LABELS:Record<string,string>={sku:'Mã SKU',name:'Tên',unit:'Đơn vị tính',minStock:'Tồn tối thiểu',stock:'Tồn kho',email:'Email',phone:'Số điện thoại',reputation:'Điểm uy tín',active:'Trạng thái hoạt động',productId:'Mặt hàng',supplierId:'Nhà cung cấp',supplierIds:'Nhà cung cấp',unitPrice:'Đơn giá',deliveryDays:'Số ngày giao',qualityScore:'Điểm chất lượng',serviceScore:'Điểm dịch vụ',quantity:'Số lượng',acceptedQuantity:'Số lượng đạt',reason:'Lý do',items:'Danh sách dòng',requestId:'Yêu cầu',requestLineId:'Dòng yêu cầu',rfqId:'RFQ',orderId:'Đơn mua',orderLineId:'Dòng đơn mua',sessionIds:'Phiên AHP',vat:'VAT',currency:'Tiền tệ',validUntil:'Ngày hiệu lực',source:'Nguồn báo giá',receivedAt:'Thời điểm nhận',idempotencyKey:'Khóa chống lặp',notes:'Ghi chú',approved:'Quyết định',comment:'Nhận xét'};
/** "items.1.quantity" reads as "Dòng 2 · Số lượng". */
const fieldLabel=(path:PropertyKey[])=>path.filter(part=>part!=='items'||path.length===1).map(part=>typeof part==='number'?`Dòng ${part+1}`:LABELS[String(part)]??String(part)).join(' · ');
/** One sentence a person filling a form can act on. A message written in the
 * schema itself (they are in Vietnamese, so not plain ASCII) is used as is; the
 * library's own wording is replaced. */
function explain(issue:any):string {
 if(/[^\x00-\x7f]/.test(issue.message))return issue.message;
 const bound=issue.minimum??issue.maximum,text=issue.origin==='string',list=issue.origin==='array'||issue.origin==='set';
 switch(issue.code){
  case 'invalid_type':return /received undefined$/.test(issue.message)?'chưa nhập':issue.expected==='int'?'phải là số nguyên':issue.expected==='number'?'phải là số':'sai kiểu dữ liệu';
  case 'too_small':return text?(bound<=1?'không được để trống':`cần ít nhất ${bound} ký tự`):list?`cần ít nhất ${bound} mục`:issue.inclusive?`phải từ ${bound} trở lên`:`phải lớn hơn ${bound}`;
  case 'too_big':return text?`tối đa ${bound} ký tự`:list?`tối đa ${bound} mục`:`tối đa ${Number(bound).toLocaleString('vi-VN')}`;
  case 'invalid_format':return 'sai định dạng';
  default:return 'giá trị không hợp lệ';
 }
}
/** `plain` is for schemas whose messages are complete sentences and need no field label. */
export function parse<T>(schema:z.ZodType<T>,value:unknown,plain=false):T {const result=schema.safeParse(value);if(!result.success)throw new DomainError(result.error.issues.map(i=>plain?explain(i):`${fieldLabel(i.path)}: ${explain(i)}`).join('; '));return result.data}
