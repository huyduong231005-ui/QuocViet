import { useEffect, useState } from 'react';
import { Alert, App, Button, Modal, Space, Upload } from 'antd';
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import { useWorkspace } from '../api';
import { number } from '../components';

interface Result {committed:boolean;created:{products:number;suppliers:number;prices:number};errors:string[]}
const toBase64=(file:File)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Không đọc được file'));reader.readAsDataURL(file);});

/** Catalog import in two steps: choosing a file only checks it and shows what
 * would be created; nothing is written until the checked file is confirmed.
 * One wrong row rejects the whole file, so a catalog is never half imported. */
export function CatalogImport({open,onClose}:{open:boolean;onClose:()=>void}){
 const {auth,request,reload}=useWorkspace();const {message}=App.useApp();
 const [file,setFile]=useState<File|null>(null);const [content,setContent]=useState('');const [preview,setPreview]=useState<Result|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 useEffect(()=>{if(open){setFile(null);setContent('');setPreview(null);setError('');}},[open]);
 const check=async(chosen:File)=>{
  setFile(chosen);setPreview(null);setError('');setBusy(true);
  try{const fileBase64=await toBase64(chosen);setContent(fileBase64);setPreview(await request<Result>('/catalog/import',{fileBase64,commit:false}));}
  catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 };
 const commit=async()=>{
  setBusy(true);
  try{
   const result=await request<Result>('/catalog/import',{fileBase64:content,commit:true});
   if(!result.committed){setPreview(result);return;}
   message.success(`Đã nhập ${number(result.created.products)} mặt hàng, ${number(result.created.suppliers)} nhà cung cấp, ${number(result.created.prices)} giá tham khảo`);
   await reload();onClose();
  }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 };
 const template=async()=>{
  try{
   const response=await fetch('/api/catalog/template',{headers:{Authorization:`Bearer ${auth?.token||''}`}});if(!response.ok)throw new Error('Không tải được file mẫu');
   const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download='danh-muc-mau.xlsx';link.click();URL.revokeObjectURL(url);
  }catch(e){message.error(e instanceof Error?e.message:String(e));}
 };
 const ready=!!preview&&!preview.errors.length&&preview.created.products+preview.created.suppliers+preview.created.prices>0;
 return <Modal title="Nhập danh mục từ Excel" open={open} onCancel={onClose} width={640} destroyOnHidden footer={<Space><Button onClick={onClose}>Đóng</Button><Button type="primary" disabled={!ready} loading={busy&&ready} onClick={()=>void commit()}>Nhập vào hệ thống</Button></Space>}>
  <p className="muted">File gồm ba sheet: <strong>Mặt hàng</strong>, <strong>Nhà cung cấp</strong>, <strong>Giá tham khảo</strong>. Chọn file để kiểm tra trước; chưa có gì được ghi cho đến khi bạn bấm “Nhập vào hệ thống”.</p>
  <Space wrap>
   <Upload accept=".xlsx" maxCount={1} showUploadList={false} beforeUpload={chosen=>{if(chosen.size>5*1024*1024){setError('File tối đa 5 MB');return Upload.LIST_IGNORE;}void check(chosen);return false;}}>
    <Button icon={<UploadOutlined aria-hidden/>} loading={busy&&!ready}>{file?'Chọn file khác':'Chọn file .xlsx'}</Button>
   </Upload>
   <Button type="link" icon={<DownloadOutlined aria-hidden/>} onClick={()=>void template()}>Tải file mẫu</Button>
  </Space>
  {file&&<p className="muted" style={{marginTop:8}}>Đang xem: {file.name}</p>}
  {error&&<Alert type="error" showIcon message={error} style={{marginTop:12}}/>}
  {preview&&!preview.errors.length&&<Alert type={ready?'success':'warning'} showIcon style={{marginTop:12}} message={ready?'File hợp lệ':'File không có dòng dữ liệu nào'} description={`Sẽ tạo ${number(preview.created.products)} mặt hàng, ${number(preview.created.suppliers)} nhà cung cấp và ${number(preview.created.prices)} giá tham khảo.`}/>}
  {preview&&!!preview.errors.length&&<Alert type="error" showIcon style={{marginTop:12}} message={`File bị từ chối: ${preview.errors.length} dòng lỗi, chưa có gì được ghi`} description={<div className="import-errors">{preview.errors.slice(0,50).map((line,index)=><div key={index}>{line}</div>)}{preview.errors.length>50&&<div>… và {preview.errors.length-50} dòng lỗi khác</div>}</div>}/>}
 </Modal>;
}
