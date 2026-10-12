import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Input, Modal, Space } from 'antd';
import { useWorkspace } from '../api';
import { can } from '../logic';
import type { AgentStatus } from '../types';
import {parseGeminiKeys} from '../gemini-keys';

export function AgentConnection({navigate}:{navigate:(page:string)=>void}){
 const {auth,request}=useWorkspace();
 const [status,setStatus]=useState<AgentStatus|null>(null),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false);
 const [keyOpen,setKeyOpen]=useState(false),[saving,setSaving]=useState(false),[keyInputs,setKeyInputs]=useState(['']);
 const {modal,message}=App.useApp();
 const refresh=useCallback(async()=>{
  setLoading(true);
  try{setStatus(await request<AgentStatus>('/agent/status'));setFailed(false)}catch{setFailed(true)}finally{setLoading(false)}
 },[request]);
 useEffect(()=>{void refresh()},[refresh]);
 const ready=status?.reachable&&status.extractionEnabled;
 const admin=auth?.user.role==='admin';
 const closeKeys=()=>{setKeyOpen(false);setKeyInputs(['']);};
 const useAi=()=>modal.confirm({title:'Bạn có muốn sử dụng AI không?',content:'Gemini sẽ đọc nội dung báo giá và trả bản nháp để bạn kiểm tra trước khi lưu. API key chỉ được gửi đến backend.',okText:'Xác nhận',cancelText:'Hủy',onOk:()=>{setKeyInputs(['']);setKeyOpen(true);}});
 const saveKeys=async()=>{
  let keys:string[];try{keys=parseGeminiKeys(keyInputs)}catch(error){message.error(error instanceof Error?error.message:'Key không hợp lệ.');return;}
  setSaving(true);
  try{await request('/agent/config/gemini',{keys});closeKeys();message.success('Đã cấu hình Gemini.');await refresh();}
  catch(error){message.error(error instanceof Error?error.message:'Chưa lưu được Gemini key.');}
  finally{setSaving(false);}
 };
 const title=failed?'Chưa kiểm tra được kết nối Agent':!status?'Đang kiểm tra kết nối Agent':!status.extractionEnabled&&!status.enabled?'Chức năng Agent chưa được bật':!status.reachable?'Dịch vụ Agent chưa kết nối':status.llmConfigured?`Dịch vụ Agent đã kết nối; ${status.provider==='gemini'?'Gemini':'API AI'} đã cấu hình`:status.provider==='gemini'?'Dịch vụ Agent đã kết nối; Gemini đang chờ API key':'Dịch vụ Agent đã kết nối; chưa cấu hình API AI';
 const description=status?.reachable?(status.llmConfigured?`Mô hình: ${status.model||'API AI'}${status.provider==='gemini'?` · ${status.keyCount} key đã cấu hình`:''}. Trích xuất sẽ gọi mô hình và hiển thị bản nháp để bạn kiểm tra. Trạng thái này chưa xác minh key với nhà cung cấp.`:admin?'Bạn có thể thử đọc văn bản và PDF bằng quy tắc. Bấm Sử dụng AI để nhập Gemini key.':'Bạn có thể thử đọc văn bản và PDF bằng quy tắc. Đăng nhập quản trị để cấu hình Gemini key.'):status?.extractionEnabled?'Khởi động dịch vụ Agent rồi bấm Kiểm tra kết nối.':undefined;
 return <><Alert showIcon type={failed||status&&(status.extractionEnabled||status.enabled)&&!status.reachable?'warning':'info'} message={title} description={description} action={<Space wrap><Button loading={loading} onClick={()=>void refresh()}>Kiểm tra kết nối</Button>{ready&&<Button disabled={!admin} onClick={useAi}>{status?.llmConfigured?'Thay Gemini key':'Sử dụng AI'}</Button>}{ready&&auth&&can(auth.user.role,'buy')&&<Button type="primary" onClick={()=>navigate('procurement')}>Mở Yêu cầu và báo giá</Button>}</Space>}/><Modal title="Nhập Gemini API key" open={keyOpen} onCancel={closeKeys} onOk={()=>void saveKeys()} confirmLoading={saving} okText="Lưu và sử dụng AI" cancelText="Hủy" okButtonProps={{disabled:!keyInputs.some(value=>value.trim())}}><p>Mỗi ô nhập một key. Có thể dán nhiều key cách nhau bằng dấu phẩy. Key được lưu trên máy chủ và không hiển thị lại sau khi lưu.</p><Space direction="vertical" style={{width:'100%'}}>{keyInputs.map((value,index)=><Input.Password key={index} aria-label={`Gemini API key ${index+1}`} autoComplete="off" value={value} onChange={event=>setKeyInputs(current=>current.map((item,i)=>i===index?event.target.value:item))} placeholder={`Gemini API key ${index+1}`}/>)}</Space>{keyInputs.length<20&&<Button type="link" onClick={()=>setKeyInputs(current=>[...current,''])}>+ Thêm key</Button>}</Modal></>;
}
