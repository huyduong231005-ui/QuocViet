import { useState } from 'react';
import { Alert, Button, Checkbox, Input, Select, Tabs } from 'antd';
import { SearchOutlined, WarningOutlined } from '@ant-design/icons';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { useWorkspace } from '../api';
import { can } from '../logic';
import { Bar, Chip, DataTable, EmptyState, GoodsTile, PageTitle, Section, date, money, number, shortId } from '../components';
import { ShelfArt } from '../illustrations';
import { PagedTable } from '../PagedTable';
import type { Inventory, Movement } from '../types';
/** Stock as a list: what is short comes first, and each row shows stock against its minimum. */
function StockList({navigate}:{navigate:(p:string)=>void}){
 const {data,auth}=useWorkspace();const [query,setQuery]=useState('');const [onlyLow,setOnlyLow]=useState(false);
 if(!data||!auth)return null;
 const request=can(auth.user.role,'request'),needs=(item:Inventory)=>item.stock<item.minStock||item.reorderQuantity>0;
 const term=query.trim().toLocaleLowerCase('vi');
 const rows=data.inventory.filter(item=>(!onlyLow||needs(item))&&`${item.name} ${item.sku}`.toLocaleLowerCase('vi').includes(term)).sort((a,b)=>Number(needs(b))-Number(needs(a)));
 const low=data.inventory.filter(item=>item.stock<item.minStock).length,value=data.dashboard.inventoryValue;
 return <>
  <div className="tray" style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:'20px 40px'}}>
   <div className="kpis" style={{flex:'1 1 360px'}}><div className="kpi"><span>Mặt hàng trong kho</span><strong>{number(data.inventory.length)}</strong></div><div className={`kpi ${low?'low':''}`}><span>Dưới mức tối thiểu</span><strong>{number(low)}</strong></div><div className="kpi"><span>Giá trị tồn kho</span><strong>{value===null?'Vượt giới hạn hiển thị':money(value)}</strong></div></div>
   <div style={{flex:'0 1 260px',minWidth:0}}><ShelfArt missing={low>0}/></div>
  </div>
  <div className="table-tray">
   <div className="table-toolbar"><Input prefix={<SearchOutlined aria-hidden/>} allowClear placeholder="Tìm theo tên hoặc mã hàng…" aria-label="Tìm mặt hàng" value={query} onChange={e=>setQuery(e.target.value)} style={{maxWidth:320}}/><Checkbox checked={onlyLow} onChange={e=>setOnlyLow(e.target.checked)}>Chỉ hiện mặt hàng cần bổ sung</Checkbox></div>
   <div role="list">{rows.map(item=>{const scale=Math.max(item.stock,item.minStock,1)*1.25,short=item.stock<item.minStock;return <div key={item.productId} className="stock-row" role="listitem">
    <div className="with-tile"><GoodsTile name={item.name}/><div className="tile-text"><strong>{item.name}</strong><span className="muted">{item.sku}</span></div></div>
    <div className="stock-gauge"><div><strong className={short?'warning-text':''}>Còn {number(item.stock)} {item.unit}</strong><span className="muted">Tối thiểu {number(item.minStock)}, dự báo {number(item.forecast)}</span></div><Bar className={`lg ${short?'low':''}`} value={100*item.stock/scale} mark={100*item.minStock/scale}/></div>
    {short?<Chip tone="wait" icon={<WarningOutlined aria-hidden/>}>Dưới mức tối thiểu</Chip>:<Chip tone="done">Đủ hàng</Chip>}
    {request&&<Button type={needs(item)?'primary':'default'} aria-label={`${item.reorderQuantity>0?`Nhập ${number(item.reorderQuantity)} ${item.unit}`:'Tạo yêu cầu'}: ${item.name}`} onClick={()=>{sessionStorage.setItem('procureiq-product',item.productId);navigate('procurement');}}>{item.reorderQuantity>0?`Nhập ${number(item.reorderQuantity)} ${item.unit}`:'Tạo yêu cầu'}</Button>}
   </div>;})}</div>
   {!rows.length&&<EmptyState art="box" title="Không có mặt hàng phù hợp"/>}
  </div>
 </>;
}
export function InventoryPage({navigate}:{navigate:(p:string)=>void}){
 const {data,auth}=useWorkspace();const [productId,setProductId]=useState<string>();const [movementProduct,setMovementProduct]=useState<string>();const [movementKind,setMovementKind]=useState<string>();if(!data||!auth)return null;const selected=productId||data.products[0]?.id;const history=data.history.filter(h=>h.productId===selected);const monthly=[...new Set(history.map(h=>h.month))].sort().map(month=>({month,quantity:history.filter(h=>h.month===month).reduce((sum,h)=>sum+h.quantity,0)}));
 return <><PageTitle title="Tồn kho và dự báo" description="Đối chiếu tồn kho thực tế với mức tối thiểu và dự báo. Tồn kho chỉ thay đổi qua tồn đầu và phiếu nhận."/><Tabs items={[{key:'inventory',label:'Tồn kho',children:<StockList navigate={navigate}/>},{key:'movements',label:'Biến động kho',children:<PagedTable<Movement> path="/inventory/movements" params={{productId:movementProduct,kind:movementKind}} searchPlaceholder="Tìm theo mặt hàng, nhà cung cấp, người thực hiện..." filters={<><label htmlFor="movement-product" className="sr-only">Lọc mặt hàng</label><Select id="movement-product" allowClear showSearch optionFilterProp="label" placeholder="Mọi mặt hàng" value={movementProduct} onChange={setMovementProduct} options={data.products.map(p=>({value:p.id,label:`${p.sku} · ${p.name}`}))} style={{width:240}}/><Select aria-label="Lọc loại biến động" allowClear placeholder="Mọi loại" value={movementKind} onChange={setMovementKind} options={[{value:'OPENING',label:'Tồn đầu'},{value:'RECEIPT',label:'Nhập hàng'}]} style={{width:140}}/></>} columns={[{title:'Thời điểm',dataIndex:'createdAt',render:date},{title:'Mặt hàng',render:(_,m)=><><strong>{m.productName}</strong><div className="muted mono">{m.sku}</div></>},{title:'Loại',dataIndex:'kind',render:v=>v==='OPENING'?'Tồn đầu':'Nhập hàng'},{title:'Thay đổi',dataIndex:'delta',render:(v,m)=><strong className="teal">+{number(v)} {m.unit}</strong>},{title:'Tồn sau',dataIndex:'balanceAfter',render:(v,m)=>`${number(v)} ${m.unit}`},{title:'Chứng từ',render:(_,m)=>m.orderId?<>PO <span className="mono">{shortId(m.orderId)}</span><div className="muted">{m.supplierName}</div></>:'Khai báo khi tạo mặt hàng'},{title:'Người thực hiện',dataIndex:'actorName'}]}/>},{key:'history',label:'Lịch sử & dự báo',children:<><Alert type="info" showIcon message={data.demoMode?'Lịch sử 24 tháng là dữ liệu mô phỏng (synthetic), dùng để minh họa dự báo và phân tích.':history.length?'Dự báo là trung bình ba tháng gần nhất trong lịch sử mua.':'Chưa có lịch sử mua theo tháng, nên dự báo đang lấy bằng mức tồn tối thiểu của từng mặt hàng.'}/><Section title="Lượng mua theo tháng" description="Tổng lượng mua theo mặt hàng trong lịch sử." actions={<Select aria-label="Mặt hàng lịch sử" value={selected} onChange={setProductId} options={data.products.map(p=>({value:p.id,label:p.name}))} style={{width:260}}/>}><ResponsiveContainer width="100%" height={280}><LineChart data={monthly} margin={{left:0,right:25}}><CartesianGrid stroke="#edf1f2"/><XAxis dataKey="month" tick={{fontSize:11}} minTickGap={20}/><YAxis tick={{fontSize:11}}/><Tooltip formatter={v=>number(Number(v))}/><Legend/><Line dataKey="quantity" name="Lượng mua" stroke="#147d73" strokeWidth={2.5} dot={false}/></LineChart></ResponsiveContainer></Section><DataTable rows={history} columns={[{title:'Tháng',dataIndex:'month'},{title:'Nhà cung cấp',render:(_,h)=>data.suppliers.find(s=>s.id===h.supplierId)?.name||shortId(h.supplierId)},{title:'Số lượng',dataIndex:'quantity',render:number},{title:'Đơn giá',dataIndex:'unitPrice',render:money},{title:'Đúng hạn',dataIndex:'onTime',render:v=>v?'Có':'Không'},{title:'Chất lượng',dataIndex:'qualityScore',render:number}]}/></>} ]}/></>;
}
