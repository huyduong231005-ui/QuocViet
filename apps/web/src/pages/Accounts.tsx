import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Popconfirm, Space } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EditOutlined, KeyOutlined, LockOutlined, UnlockOutlined } from '@ant-design/icons';
import { useWorkspace } from '../api';
import { AddButton, Chip, DataTable, Editor, PageTitle, date, roleNames, type Field } from '../components';
import type { Account } from '../types';

const roleOptions=Object.entries(roleNames).map(([value,label])=>({value,label}));
const passwordHelp='Ít nhất 8 ký tự, có cả chữ cái và chữ số.';
const fields:Record<'create'|'edit'|'password',Field[]>={
 create:[{name:'name',label:'Họ tên'},{name:'email',label:'Email đăng nhập'},{name:'role',label:'Vai trò',kind:'select',options:roleOptions},{name:'password',label:'Mật khẩu ban đầu',kind:'password',help:passwordHelp}],
 edit:[{name:'name',label:'Họ tên'},{name:'role',label:'Vai trò',kind:'select',options:roleOptions}],
 password:[{name:'password',label:'Mật khẩu mới',kind:'password',help:`${passwordHelp} Người dùng sẽ phải đăng nhập lại.`}],
};
export function AccountsPage(){
 const {auth,request,mutate,busy}=useWorkspace();
 const [rows,setRows]=useState<Account[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
 const [mode,setMode]=useState<'create'|'edit'|'password'|null>(null);const [selected,setSelected]=useState<Account|null>(null);
 const isAdmin=auth?.user.role==='admin';
 const load=useCallback(async()=>{setLoading(true);try{setRows(await request<Account[]>('/accounts'));setError('');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setLoading(false);}},[request]);
 useEffect(()=>{if(isAdmin)void load();},[isAdmin,load]);
 if(!auth)return null;
 if(!isAdmin)return <><PageTitle title="Tài khoản" description="Tạo tài khoản và phân vai trò cho người dùng."/><Alert type="info" showIcon message="Chỉ quản trị viên được quản lý tài khoản."/></>;
 const open=(next:'create'|'edit'|'password',account?:Account)=>{setSelected(account||null);setMode(next);};
 const save=async(path:string,body:unknown,method?:string)=>{const saved=await mutate<Account>(path,body,method);if(saved)await load();return !!saved;};
 const submit=(values:Record<string,unknown>)=>mode==='create'?save('/accounts',values):mode==='edit'?save(`/accounts/${selected!.id}`,values,'PATCH'):save(`/accounts/${selected!.id}/password`,values);
 const columns:ColumnsType<Account>=[
  {title:'Họ tên',dataIndex:'name',render:(v,r)=><strong>{v}{r.id===auth.user.id&&<span className="muted"> · bạn</span>}</strong>},
  {title:'Email đăng nhập',dataIndex:'email'},
  {title:'Vai trò',dataIndex:'role',render:v=>roleNames[v]||v},
  {title:'Trạng thái',dataIndex:'active',render:v=><Chip tone={v?'done':'idle'}>{v?'Đang hoạt động':'Đã khóa'}</Chip>},
  {title:'Tạo lúc',dataIndex:'createdAt',render:date},
  {title:'Thao tác',key:'actions',render:(_,r)=><Space>
   <Button type="text" size="small" icon={<EditOutlined aria-hidden/>} onClick={()=>open('edit',r)} aria-label={`Sửa tài khoản ${r.name}`}/>
   <Button type="text" size="small" icon={<KeyOutlined aria-hidden/>} onClick={()=>open('password',r)} aria-label={`Đặt lại mật khẩu của ${r.name}`}/>
   {r.id!==auth.user.id&&<Popconfirm title={r.active?'Khóa tài khoản này?':'Mở lại tài khoản này?'} description={r.active?'Người dùng bị đăng xuất ngay và không đăng nhập được nữa.':'Người dùng đăng nhập lại được bằng mật khẩu hiện có.'} okText={r.active?'Khóa':'Mở lại'} cancelText="Hủy" onConfirm={()=>save(`/accounts/${r.id}`,{active:!r.active},'PATCH')}>
    <Button type="text" size="small" danger={r.active} loading={busy} icon={r.active?<LockOutlined aria-hidden/>:<UnlockOutlined aria-hidden/>} aria-label={`${r.active?'Khóa':'Mở lại'} tài khoản ${r.name}`}/>
   </Popconfirm>}
  </Space>},
 ];
 const title=mode==='create'?'Thêm tài khoản':mode==='edit'?`Sửa tài khoản ${selected?.name??''}`:`Đặt lại mật khẩu cho ${selected?.name??''}`;
 return <>
  <PageTitle title="Tài khoản" description="Tạo tài khoản, phân vai trò, khóa và đặt lại mật khẩu. Tài khoản đã thao tác không bị xóa để giữ lịch sử." actions={<AddButton onClick={()=>open('create')}>Thêm tài khoản</AddButton>}/>
  {error&&<Alert type="error" showIcon message="Không tải được danh sách tài khoản" description={error} action={<Button onClick={()=>void load()}>Thử lại</Button>}/>}
  <DataTable rows={rows} columns={columns} searchPlaceholder="Tìm theo tên, email, vai trò..." extra={loading?<span className="muted">Đang tải...</span>:undefined}/>
  <Editor title={title} open={mode!==null} onClose={()=>setMode(null)} fields={mode?fields[mode]:[]} initial={mode==='edit'&&selected?{name:selected.name,role:selected.role}:mode==='create'?{role:'buyer'}:{}} onSave={submit}/>
 </>;
}
