import { useEffect, useState } from 'react';
import { Alert, Form, Input, InputNumber, Modal } from 'antd';
import { receiptItemsPayload } from '../logic';
import { number, shortId } from '../components';
import type { Order } from '../types';

interface Line {quantity?:number|null;acceptedQuantity?:number|null}
/** One delivery against a PO: a row per line still open, with what is left to
 * receive. The retry key is created when the dialog opens and reused until
 * the receipt is saved, so pressing Save twice cannot post stock twice. */
export function ReceiptEditor({order,supplierName,onClose,onSave}:{order:Order|null;supplierName:string;onClose:()=>void;onSave:(body:ReturnType<typeof receiptItemsPayload>)=>Promise<boolean>}){
 const [form]=Form.useForm<{receivedAt:string;notes?:string;lines:Line[]}>();const [saving,setSaving]=useState(false);const [key,setKey]=useState('');const [error,setError]=useState('');
 const open=(order?.items??[]).filter(line=>line.receivedQuantity<line.quantity);
 useEffect(()=>{
  if(!order)return;
  setKey(crypto.randomUUID());setError('');form.resetFields();
  form.setFieldsValue({receivedAt:new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,19),notes:'',lines:order.items.filter(line=>line.receivedQuantity<line.quantity).map(line=>({quantity:line.quantity-line.receivedQuantity,acceptedQuantity:line.quantity-line.receivedQuantity}))});
 },[order,form]);
 const save=async()=>{
  if(!order)return;
  try{
   const values=await form.validateFields();
   const body=receiptItemsPayload(order.id,open.map((line,index)=>({orderLineId:line.id,...values.lines[index]})),values.receivedAt,values.notes??'',key);
   if(!body.items.length){setError('Nhập số lượng giao cho ít nhất một dòng.');return;}
   if(body.items.some(item=>item.acceptedQuantity>item.quantity)){setError('Số lượng đạt không được vượt số lượng giao.');return;}
   setError('');setSaving(true);
   if(await onSave(body))onClose();
  }catch{/* field errors are shown by the form */}finally{setSaving(false);}
 };
 return <Modal title="Nhận hàng theo đợt" open={!!order} onCancel={onClose} onOk={()=>void save()} confirmLoading={saving} okText="Ghi phiếu nhận" cancelText="Hủy" width={680} destroyOnHidden>
  {order&&<Form name="receipt-editor" form={form} layout="vertical" className="editor-form">
   <Alert type="info" showIcon message={`PO ${shortId(order.id)} · ${supplierName}`} description={`Tồn kho chỉ cộng số lượng đạt yêu cầu. Dòng nào chưa giao trong đợt này thì để 0. Khóa ${shortId(key)} giữ nguyên khi thử lại.`}/>
   {error&&<Alert type="error" showIcon message={error} style={{marginTop:12}}/>}
   <div className="line-editor-head receipt"><span>Mặt hàng</span><span>Còn lại</span><span>Giao đợt này</span><span>Đạt yêu cầu</span></div>
   {open.map((line,index)=><div className="line-editor-row receipt" key={line.id}>
    <div><strong>{line.productName}</strong><div className="muted mono">{line.productSku}</div></div>
    <div>{number(line.quantity-line.receivedQuantity)} {line.unit}</div>
    <Form.Item name={['lines',index,'quantity']}><InputNumber aria-label={`Số lượng giao ${line.productName}`} min={0} max={line.quantity-line.receivedQuantity} precision={0} style={{width:'100%'}}/></Form.Item>
    <Form.Item name={['lines',index,'acceptedQuantity']}><InputNumber aria-label={`Số lượng đạt ${line.productName}`} min={0} max={line.quantity-line.receivedQuantity} precision={0} style={{width:'100%'}}/></Form.Item>
   </div>)}
   <Form.Item name="receivedAt" label="Thời điểm nhận" rules={[{required:true,message:'Nhập thời điểm nhận'}]} style={{marginTop:16}}><Input aria-label="Thời điểm nhận" type="datetime-local"/></Form.Item>
   <Form.Item name="notes" label="Ghi chú"><Input.TextArea aria-label="Ghi chú" rows={2} maxLength={2000}/></Form.Item>
  </Form>}
 </Modal>;
}
