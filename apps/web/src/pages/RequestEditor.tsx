import { useEffect, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal } from 'antd';
import { FormSelect } from '../components';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { Product } from '../types';

const MAX_LINES=50;
interface Values {reason:string;items:{productId?:string;quantity?:number}[]}
/** A purchase request with one line per product. Each line shows the product's
 * own unit, and a product already on another line is not offered again. */
export function RequestEditor({open,onClose,products,initialProductId,onSave}:{open:boolean;onClose:()=>void;products:Product[];initialProductId?:string;onSave:(body:{reason:string;items:{productId:string;quantity:number}[]})=>Promise<boolean>}){
 const [form]=Form.useForm<Values>();const [saving,setSaving]=useState(false);
 const items=Form.useWatch('items',form)||[];
 // Reset only when the dialog opens, so a failed save keeps what was typed.
 useEffect(()=>{if(open){form.resetFields();form.setFieldsValue({reason:'',items:[{productId:initialProductId,quantity:1}]});}},[open,initialProductId,form]);
 const unit=(productId?:string)=>products.find(p=>p.id===productId)?.unit;
 const save=async()=>{
  try{
   const values=await form.validateFields();setSaving(true);
   if(await onSave({reason:values.reason,items:values.items.map(item=>({productId:item.productId!,quantity:item.quantity!}))}))onClose();
  }catch{/* field errors are shown by the form */}finally{setSaving(false);}
 };
 return <Modal title="Tạo yêu cầu nhập hàng" open={open} onCancel={onClose} onOk={()=>void save()} confirmLoading={saving} okText="Gửi duyệt" cancelText="Hủy" width={640} destroyOnHidden>
  <Form name="request-editor" form={form} layout="vertical" className="editor-form">
   <Form.List name="items">{(fields,{add,remove})=><>
    <div className="line-editor-head"><span>Mặt hàng</span><span>Số lượng</span><span/></div>
    {fields.map((field,index)=><div className="line-editor-row" key={field.key}>
     <Form.Item name={[field.name,'productId']} label={`Mặt hàng dòng ${index+1}`} className="sr-label" rules={[{required:true,message:'Chọn mặt hàng'}]}>
      <FormSelect showSearch optionFilterProp="label" placeholder="Chọn mặt hàng" options={products.filter(p=>p.id===items[index]?.productId||!items.some(item=>item?.productId===p.id)).map(p=>({value:p.id,label:`${p.sku} · ${p.name}`}))}/>
     </Form.Item>
     <Form.Item name={[field.name,'quantity']} rules={[{required:true,message:'Nhập số lượng'}]}>
      <InputNumber aria-label={`Số lượng dòng ${index+1}`} min={1} max={10000000} precision={0} addonAfter={unit(items[index]?.productId)||'đơn vị'} style={{width:'100%'}}/>
     </Form.Item>
     <Button type="text" danger icon={<DeleteOutlined aria-hidden/>} disabled={fields.length===1} onClick={()=>remove(field.name)} aria-label={`Xóa dòng ${index+1}`}/>
    </div>)}
    <Button type="dashed" icon={<PlusOutlined aria-hidden/>} disabled={fields.length>=Math.min(MAX_LINES,products.length)} onClick={()=>add({quantity:1})} block>Thêm mặt hàng</Button>
   </>}</Form.List>
   <Form.Item name="reason" label="Lý do mua" rules={[{required:true,whitespace:true,message:'Nhập lý do mua'}]} style={{marginTop:16}} extra="Quản lý duyệt cả yêu cầu một lần. Sau khi duyệt, mỗi mặt hàng có RFQ và so sánh AHP riêng.">
    <Input.TextArea aria-label="Lý do mua" rows={3} maxLength={500}/>
   </Form.Item>
  </Form>
 </Modal>;
}
