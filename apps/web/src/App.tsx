import { lazy, Suspense, useEffect, useState } from 'react';
import { Alert, App as AntApp, Button, Dropdown, Form, Input, Layout, Select, Space, Spin, Tooltip } from 'antd';
import { ApartmentOutlined, AppstoreOutlined, AuditOutlined, BarChartOutlined, CheckSquareOutlined, DownOutlined, FileTextOutlined, KeyOutlined, LogoutOutlined, MenuFoldOutlined, TeamOutlined, MenuUnfoldOutlined, ReloadOutlined, RobotOutlined, ShoppingCartOutlined, StockOutlined, FileExcelOutlined, FilePdfOutlined } from '@ant-design/icons';
import { useWorkspace } from './api';
import { Editor, Sheet, roleNames } from './components';
import { LoginArt } from './illustrations';
const DashboardPage=lazy(()=>import('./pages/Dashboard').then(m=>({default:m.DashboardPage})));
const CatalogPage=lazy(()=>import('./pages/Catalog').then(m=>({default:m.CatalogPage})));
const ProcurementPage=lazy(()=>import('./pages/Procurement').then(m=>({default:m.ProcurementPage})));
const AhpPage=lazy(()=>import('./pages/Ahp').then(m=>({default:m.AhpPage})));
const ApprovalsPage=lazy(()=>import('./pages/Approvals').then(m=>({default:m.ApprovalsPage})));
const OrdersPage=lazy(()=>import('./pages/Orders').then(m=>({default:m.OrdersPage})));
const InventoryPage=lazy(()=>import('./pages/Inventory').then(m=>({default:m.InventoryPage})));
const AgentPage=lazy(()=>import('./pages/Agent').then(m=>({default:m.AgentPage})));
const AuditPage=lazy(()=>import('./pages/Audit').then(m=>({default:m.AuditPage})));
const AccountsPage=lazy(()=>import('./pages/Accounts').then(m=>({default:m.AccountsPage})));
const groups=[
  {key:'core',label:''},
  {key:'ops',label:'Vận hành Mua sắm (Nguồn phát sinh)'},
  {key:'admin',label:'Quản trị hệ thống'}
];
const navigation=[
  // TRỌNG TÂM: KẾ TOÁN & KIỂM TOÁN
  {key:'audit',group:'core',label:'Kiểm toán & Kế toán Mua sắm',icon:<AuditOutlined aria-hidden/>},
  {key:'orders',group:'core',label:'Đối soát PO & Chứng từ Nhận hàng',icon:<ShoppingCartOutlined aria-hidden/>},
  {key:'inventory',group:'core',label:'Kế toán Kho & Sổ cái Vật tư',icon:<StockOutlined aria-hidden/>},
  {key:'dashboard',group:'core',label:'Tổng quan Tài chính & Tuân thủ',icon:<BarChartOutlined aria-hidden/>},

  // CÁC KHÂU MUA HÀNG PHỤ TRỢ (DẸP XUỐNG DƯỚI)
  {key:'procurement',group:'ops',label:'Yêu cầu & Báo giá NCC',icon:<FileTextOutlined aria-hidden/>},
  {key:'ahp',group:'ops',label:'So sánh AHP (Chọn NCC)',icon:<ApartmentOutlined aria-hidden/>},
  {key:'approvals',group:'ops',label:'Phê duyệt Tờ trình (Gate 1/2)',icon:<CheckSquareOutlined aria-hidden/>},
  {key:'catalog',group:'ops',label:'Danh mục & Bảng giá',icon:<AppstoreOutlined aria-hidden/>},
  {key:'agent',group:'ops',label:'AI Agent Tự hành',icon:<RobotOutlined aria-hidden/>},

  // QUẢN TRỊ
  {key:'accounts',group:'admin',label:'Phân quyền & Tài khoản',icon:<TeamOutlined aria-hidden/>,adminOnly:true}
];
const Brand=({named}:{named:boolean})=><><span className="brand-mark" aria-hidden="true">P</span>{named&&<span className="brand-name"><strong>ProcureIQ</strong><small>Quốc Việt</small></span>}</>;
function Login(){const {login,request}=useWorkspace();const {message}=AntApp.useApp();const [loading,setLoading]=useState(false);const [error,setError]=useState('');const [demo,setDemo]=useState(false);const [registering,setRegistering]=useState(false);const [form]=Form.useForm<{name?:string;email:string;password:string}>();
 // The server says whether demo accounts exist; a real installation shows an empty form and no shared password.
 useEffect(()=>{let active=true;fetch('/api/health').then(r=>r.json()).then((health:{demoMode?:boolean})=>{if(active&&health.demoMode===true){setDemo(true);form.setFieldsValue({email:'admin@ahp.local',password:'Demo@12345'});}}).catch(()=>undefined);return()=>{active=false;};},[form]);
 const mode=(next:boolean)=>{setRegistering(next);setError('');form.resetFields();};
 // A registered account is locked until an administrator activates it, so registering does not sign in.
 const submit=async(v:{name?:string;email:string;password:string})=>{setLoading(true);setError('');try{if(registering){await request('/auth/register',{name:v.name,email:v.email,password:v.password});message.success('Đã gửi đăng ký. Quản trị viên sẽ kích hoạt tài khoản của bạn.',6);mode(false);}else await login(v.email,v.password);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setLoading(false);}};
 return <div className="login-layout"><aside className="login-brand"><div className="brand-lockup"><Brand named/></div><div className="login-art"><LoginArt/><h1>Mỗi quyết định mua đều có căn cứ.</h1></div></aside><main className="login-main"><Sheet className="login-form"><h2>{registering?'Đăng ký tài khoản':'Đăng nhập'}</h2>{error&&<Alert message={error} type="error" showIcon/>}<Form form={form} layout="vertical" onFinish={submit}>{registering&&<Form.Item name="name" label="Họ tên" rules={[{required:true,whitespace:true,message:'Nhập họ tên'}]}><Input autoComplete="name" size="large"/></Form.Item>}<Form.Item name="email" label="Email" rules={[{required:true,message:'Nhập email'},{type:'email',message:'Email không hợp lệ'}]}><Input autoComplete="username" spellCheck={false} size="large"/></Form.Item><Form.Item name="password" label="Mật khẩu" rules={registering?[{required:true,message:'Nhập mật khẩu'},{min:8,message:'Mật khẩu cần ít nhất 8 ký tự'},{pattern:/\p{L}/u,message:'Mật khẩu cần có chữ cái'},{pattern:/\d/,message:'Mật khẩu cần có chữ số'}]:[{required:true,message:'Nhập mật khẩu'}]}><Input.Password autoComplete={registering?'new-password':'current-password'} size="large"/></Form.Item><Button type="primary" htmlType="submit" size="large" block loading={loading}>{registering?'Đăng ký':'Đăng nhập'}</Button></Form><div className="login-links">{registering?<Button type="link" onClick={()=>mode(false)}>Đã có tài khoản? Đăng nhập</Button>:<><Button type="link" onClick={()=>message.info('Quản trị viên đặt lại mật khẩu cho bạn ở màn hình Tài khoản.',6)}>Quên mật khẩu?</Button><Button type="link" onClick={()=>mode(true)}>Đăng ký tài khoản</Button></>}</div>{demo&&!registering&&<div className="demo-accounts"><span>Tài khoản demo</span><Select aria-label="Chọn vai trò demo" defaultValue="admin" options={Object.entries(roleNames).map(([value,label])=>({value,label}))} onChange={role=>form.setFieldsValue({email:`${role}@ahp.local`,password:'Demo@12345'})} style={{width:'100%'}}/><p>Chọn vai trò để thử phạm vi thao tác. Mật khẩu demo: <code>Demo@12345</code></p></div>}</Sheet></main></div>;}
export function Application(){
 const {auth,data,loading,error,logout,reload,download,busy,request}=useWorkspace();const {message}=AntApp.useApp();const [passwordOpen,setPasswordOpen]=useState(false);const [collapsed,setCollapsed]=useState(false);const [mobile,setMobile]=useState(false);const [page,setPage]=useState(()=>navigation.some(n=>n.key===location.hash.slice(1))?location.hash.slice(1):'audit');
 useEffect(()=>{const onHash=()=>setPage(navigation.some(n=>n.key===location.hash.slice(1))?location.hash.slice(1):'audit');addEventListener('hashchange',onHash);return()=>removeEventListener('hashchange',onHash);},[]);
 const pageName=navigation.find(n=>n.key===page)?.label||'';
 useEffect(()=>{document.title=`${pageName} | ProcureIQ`;},[pageName]);
 const navigate=(key:string)=>{setPage(key);location.hash=key;if(mobile)setCollapsed(true);};
 if(!auth)return <Login/>;
 const visible=navigation.filter(n=>!('adminOnly' in n)||auth.user.role==='admin');
 // The new password ends this session on the server, so sign out here as well.
 const changePassword=async(values:Record<string,unknown>)=>{try{await request('/auth/password',values);message.success('Đã đổi mật khẩu. Hãy đăng nhập lại bằng mật khẩu mới.');logout();return true;}catch(e){message.error(e instanceof Error?e.message:String(e));return false;}};
 const content=page==='accounts'?<AccountsPage/>:page==='catalog'?<CatalogPage/>:page==='procurement'?<ProcurementPage navigate={navigate}/>:page==='ahp'?<AhpPage navigate={navigate}/>:page==='approvals'?<ApprovalsPage/>:page==='orders'?<OrdersPage/>:page==='inventory'?<InventoryPage navigate={navigate}/>:page==='agent'?<AgentPage navigate={navigate} enabled={data?.agentEnabled===true}/>:page==='audit'?<AuditPage/>:<DashboardPage navigate={navigate}/>;
 const named=!collapsed;
 const extra=(key:string)=>key==='approvals'&&data?.dashboard.pendingApprovals?<span className="side-badge" aria-label={`${data.dashboard.pendingApprovals} tờ trình chờ duyệt`}>{data.dashboard.pendingApprovals}</span>:key==='agent'&&data&&!data.agentEnabled?<span className="side-tag">{data.extractionEnabled?'Đọc báo giá':'Sắp có'}</span>:null;
 const today=data?new Date(`${data.businessDate}T00:00:00`).toLocaleDateString('vi-VN',{weekday:'long',day:'numeric',month:'long',year:'numeric'}):'';
 // A page change moves no focus, so its name is announced; the skip button jumps past the navigation.
 return <Layout className="app-layout"><button className="skip-link" onClick={()=>document.querySelector<HTMLElement>('.workspace-content')?.focus()}>Bỏ qua điều hướng</button><div className="sr-only" role="status">{pageName}</div>{mobile&&!collapsed&&<button className="sidebar-backdrop" aria-label="Đóng thanh điều hướng" onClick={()=>setCollapsed(true)}/>}<Layout.Sider trigger={null} width={248} collapsedWidth={mobile?0:76} collapsed={collapsed} breakpoint="lg" onBreakpoint={small=>{setMobile(small);setCollapsed(small);}} inert={mobile&&collapsed} className={`sidebar ${mobile?'sidebar-mobile':''}`} theme="dark">
  <a className="brand-lockup" href="#audit" aria-label={named?undefined:'ProcureIQ'} onClick={()=>mobile&&setCollapsed(true)}><Brand named={named}/></a>
  <nav className="side-nav" aria-label="Điều hướng chính">{groups.map(group=>{const items=visible.filter(n=>n.group===group.key);return items.length?<div key={group.key} className={`side-group ${group.key}`} role={group.label?'group':undefined} aria-label={group.label||undefined}>{group.label&&named&&<span className="side-label" aria-hidden="true">{group.label}</span>}<div className="side-links">{items.map(n=><a key={n.key} href={`#${n.key}`} className="side-link" aria-current={page===n.key?'page':undefined} aria-label={named?undefined:n.label} title={named?undefined:n.label} onClick={()=>mobile&&setCollapsed(true)}>{n.icon}{named&&<span>{n.label}</span>}{named&&extra(n.key)}</a>)}</div></div>:null;})}</nav>
  <Dropdown trigger={['click']} placement="topLeft" menu={{items:[{key:'password',label:'Đổi mật khẩu',icon:<KeyOutlined aria-hidden/>},{key:'logout',label:'Đăng xuất',icon:<LogoutOutlined aria-hidden/>}],onClick:e=>e.key==='password'?setPasswordOpen(true):logout()}}><button className="side-user" aria-label={named?undefined:`Tài khoản ${auth.user.name}`}><span className="side-avatar" aria-hidden="true">{auth.user.name.slice(0,1).toUpperCase()}</span>{named&&<span className="sr-only">Tài khoản </span>}{named&&<span className="side-who"><strong>{auth.user.name}</strong><small>{roleNames[auth.user.role]}</small></span>}</button></Dropdown>
 </Layout.Sider><Layout className="main-layout" style={{marginLeft:mobile?0:collapsed?76:248}}><Layout.Header className="topbar"><Space size={12}><Button type="text" icon={collapsed?<MenuUnfoldOutlined aria-hidden/>:<MenuFoldOutlined aria-hidden/>} aria-label={collapsed?'Mở điều hướng':'Thu gọn điều hướng'} onClick={()=>setCollapsed(!collapsed)}/><span className="topbar-date">{today}</span></Space><Space size={10}><Tooltip title="Cập nhật dữ liệu"><Button loading={loading} icon={<ReloadOutlined aria-hidden/>} onClick={()=>reload()} aria-label="Cập nhật dữ liệu"/></Tooltip><Dropdown menu={{items:[{key:'excel',label:'Xuất Excel',icon:<FileExcelOutlined aria-hidden/>},{key:'pdf',label:'Xuất PDF',icon:<FilePdfOutlined aria-hidden/>}],onClick:e=>download(e.key as 'pdf'|'excel')}}><Button loading={busy}>Xuất báo cáo <DownOutlined aria-hidden/></Button></Dropdown></Space></Layout.Header><Layout.Content className="workspace-content" tabIndex={-1}>{error&&<Alert showIcon type="error" message="Không tải được dữ liệu" description={error} action={<Button onClick={()=>reload()}>Thử lại</Button>} style={{marginTop:24}}/>} {!data&&loading?<div className="loading-workspace"><Spin size="large"/></div>:data?<div key={page} className="page"><Suspense fallback={<div className="loading-workspace" role="status"><Spin size="large"/></div>}>{content}</Suspense></div>:!error?<div className="loading-workspace"><Button onClick={()=>reload()}>Tải dữ liệu</Button></div>:null}<Editor title="Đổi mật khẩu" open={passwordOpen} onClose={()=>setPasswordOpen(false)} submitLabel="Đổi mật khẩu" fields={[{name:'currentPassword',label:'Mật khẩu hiện tại',kind:'password'},{name:'newPassword',label:'Mật khẩu mới',kind:'password',help:'Ít nhất 8 ký tự, có cả chữ cái và chữ số.'}]} onSave={changePassword}/></Layout.Content></Layout></Layout>;
}
