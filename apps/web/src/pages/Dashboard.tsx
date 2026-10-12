import type { ReactNode } from 'react';
import { Button } from 'antd';
import { ApartmentOutlined, CheckSquareOutlined, FileTextOutlined, InboxOutlined, MailOutlined, RightOutlined, ShoppingCartOutlined, StarOutlined, TagsOutlined, WarningOutlined } from '@ant-design/icons';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useWorkspace } from '../api';
import { can, describeLines, flowStations, openRequestLines, poCandidates, unratedOrders, type Station } from '../logic';
import { Bar, EmptyState, GoodsTile, Section, Sheet, SupplierAvatar, date, money, number, shortId } from '../components';
import { DeskArt } from '../illustrations';

const stops:Record<Station['key'],{label:string;note:string;icon:ReactNode;page:string}>={
 requests:{label:'Nhu cầu',note:'chờ duyệt',icon:<FileTextOutlined aria-hidden/>,page:'approvals'},
 quotes:{label:'Báo giá',note:'cần thu báo giá',icon:<TagsOutlined aria-hidden/>,page:'procurement'},
 ahp:{label:'So sánh AHP',note:'phiên chưa trình duyệt',icon:<ApartmentOutlined aria-hidden/>,page:'ahp'},
 choice:{label:'Chọn nhà cung cấp',note:'chờ duyệt',icon:<CheckSquareOutlined aria-hidden/>,page:'approvals'},
 orders:{label:'Đơn mua',note:'cần lập hoặc đang nhận',icon:<ShoppingCartOutlined aria-hidden/>,page:'orders'},
 evaluate:{label:'Đánh giá',note:'chờ đánh giá',icon:<StarOutlined aria-hidden/>,page:'orders'},
};
/** One thing the signed-in person can do now. `warn` marks a notice rather than a pending document. */
interface Task {key:string;icon:ReactNode;warn?:boolean;title:string;detail:string;meta?:string;action:string;page:string}
const MAX_TASKS=6;

export function DashboardPage({navigate}:{navigate:(p:string)=>void}){
 const {data,auth}=useWorkspace();if(!data||!auth)return null;
 const d=data.dashboard,role=auth.user.role;
 const supplierName=(id:string)=>data.suppliers.find(s=>s.id===id)?.name||shortId(id);
 const low=data.inventory.filter(item=>item.stock<item.minStock);
 const pending=data.approvals.filter(a=>a.status==='pending');

 const tasks:Task[]=[];
 if(can(role,'approve'))for(const a of pending){
  // A gate-2 approval is about one RFQ line; a gate-1 approval about every line of its request.
  const rfq=data.rfqs.find(q=>q.id===a.rfqId),request=data.requests.find(r=>r.id===a.requestId);
  const lines=describeLines(a.gate===2&&rfq?[rfq]:a.lines||request?.items||[],data.products),reason=a.reason||request?.reason;
  tasks.push({key:a.id,icon:<FileTextOutlined aria-hidden/>,title:`${a.gate===1?'Duyệt nhu cầu':'Duyệt lựa chọn nhà cung cấp'}: ${lines.map(l=>l.name).join(', ')||shortId(a.requestId)}`,detail:[lines.map(l=>`${number(l.quantity)} ${l.unit}`).join(', '),reason&&`Lý do: ${reason}`].filter(Boolean).join('. '),meta:`Gửi lúc ${date(a.createdAt)}`,action:'Xem và quyết định',page:'approvals'});
 }
 if(can(role,'buy')){
  const open=openRequestLines(data.requests,data.rfqs);
  if(open.length)tasks.push({key:'rfq',icon:<TagsOutlined aria-hidden/>,title:`Gửi yêu cầu báo giá cho ${open.length} mặt hàng đã duyệt`,detail:describeLines(open,data.products).map(l=>l.name).join(', '),action:'Tạo RFQ',page:'procurement'});
  for(const s of data.ahpSessions.filter(s=>s.status==='draft')){const rfq=data.rfqs.find(q=>q.id===s.rfqId&&q.status==='open');if(rfq)tasks.push({key:s.id,icon:<ApartmentOutlined aria-hidden/>,title:`Trình duyệt lựa chọn: ${data.products.find(p=>p.id===rfq.productId)?.name||shortId(rfq.id)}`,detail:s.ranking[0]?`${s.ranking[0].supplierName} đang dẫn đầu.`:'',action:'Mở phiên AHP',page:'ahp'});}
  for(const g of poCandidates(data.ahpSessions,data.approvals,data.rfqs))tasks.push({key:`po-${g.supplierId}`,icon:<ShoppingCartOutlined aria-hidden/>,title:`Lập đơn mua cho ${supplierName(g.supplierId)}`,detail:`${g.sessionIds.length} lựa chọn đã được duyệt.`,action:'Lập PO',page:'orders'});
  for(const o of data.orders.filter(o=>!o.sentAt))tasks.push({key:`send-${o.id}`,icon:<MailOutlined aria-hidden/>,title:`Gửi PO ${shortId(o.id)} cho ${supplierName(o.supplierId)}`,detail:o.items.map(l=>l.productName).join(', '),action:'Mở đơn mua',page:'orders'});
  for(const o of unratedOrders(data.orders,data.evaluations))tasks.push({key:`rate-${o.id}`,icon:<StarOutlined aria-hidden/>,title:`Đánh giá ${supplierName(o.supplierId)}`,detail:`PO ${shortId(o.id)} đã nhận đủ.`,action:'Đánh giá',page:'orders'});
 }
 if(can(role,'receive'))for(const o of data.orders.filter(o=>o.status!=='received'))tasks.push({key:`recv-${o.id}`,icon:<InboxOutlined aria-hidden/>,title:`Nhận hàng PO ${shortId(o.id)}`,detail:`${supplierName(o.supplierId)}: ${o.items.map(l=>`${l.productName} ${number(l.receivedQuantity)}/${number(l.quantity)} ${l.unit}`).join(', ')}`,action:'Ghi nhận nhập hàng',page:'orders'});
 if(can(role,'request'))for(const item of low)tasks.push({key:`low-${item.productId}`,icon:<WarningOutlined aria-hidden/>,warn:true,title:`${item.name} dưới mức tối thiểu`,detail:`Còn ${number(item.stock)} ${item.unit}, mức tối thiểu ${number(item.minStock)}.`,action:'Xem tồn kho',page:'inventory'});

 const waiting=tasks.filter(t=>!t.warn),first=waiting[0];
 const headline=!waiting.length?'Không có việc nào đang chờ bạn':waiting.every(t=>t.page==='approvals')?`${waiting.length} tờ trình đang chờ bạn duyệt`:`${waiting.length} việc đang chờ bạn xử lý`;
 const facts=[low.length&&`${low.length} mặt hàng dưới mức tối thiểu`,d.activeOrders&&`${d.activeOrders} đơn mua đang thực hiện`].filter(Boolean).join(', ');
 const months=d.monthlySpend.filter(m=>m.value!==null),peak=Math.max(1,...months.map(m=>m.value||0));
 const spend=d.monthlySpend.find(m=>m.month===data.businessDate.slice(0,7));
 const suppliers=[...d.supplierPerformance].sort((a,b)=>b.score-a.score).slice(0,5);
 const restock=d.forecast.filter(f=>f.reorderQuantity>0).slice(0,5).map(f=>({...f,...data.inventory.find(i=>i.productId===f.productId)!}));

 return <>
  <div className="page-title hero">
   <div><h1>{headline}</h1><p>{facts?`${facts[0].toUpperCase()}${facts.slice(1)}.`:'Tồn kho đủ và không có đơn mua nào đang mở.'}</p>
    <div className="hero-actions">{first&&<Button type="primary" size="large" onClick={()=>navigate(first.page)}>{first.action}</Button>}<Button size="large" onClick={()=>navigate('inventory')}>Xem tồn kho</Button></div></div>
   <div className="hero-art"><DeskArt/></div>
  </div>

  <Section title="Dòng chảy mua hàng" description="Số chứng từ đang dừng ở từng trạm. Trạm tô vàng đang chờ bạn.">
   <div className="flow-rail">{flowStations(data,role).map((s,i,all)=><a key={s.key} href={`#${stops[s.key].page}`} className={`flow-station ${s.mine?'hot':''}`}>
    <span className="flow-name">{stops[s.key].label}</span><span className="flow-count">{number(s.count)}</span><span className="flow-note">{stops[s.key].note}</span>
    <span className="flow-top"><span className="flow-icon" aria-hidden="true">{stops[s.key].icon}</span>{s.mine?<span className="flow-you">Cần bạn</span>:i<all.length-1&&<RightOutlined className="flow-next" aria-hidden="true"/>}</span>
   </a>)}</div>
  </Section>

  <div className="columns" style={{alignItems:'flex-start'}}>
   <div className="wide"><Sheet>
    <div style={{display:'flex',alignItems:'center',gap:10}}><h2>Việc chờ bạn</h2>{!!tasks.length&&<span className="count-pill">{tasks.length}<span className="sr-only"> việc</span></span>}</div>
    {tasks.length?<div><ul className="task-list">{tasks.slice(0,MAX_TASKS).map(t=><li key={t.key} className="task">
     <span className={`tile ${t.warn?'warn':'doc'}`} aria-hidden="true">{t.icon}</span>
     <div className="task-body"><strong>{t.title}</strong>{t.detail&&<span>{t.detail}</span>}{t.meta&&<span>{t.meta}</span>}</div>
     <Button type={t.warn?'default':'primary'} aria-label={`${t.action}: ${t.title}`} onClick={()=>navigate(t.page)}>{t.action}</Button>
    </li>)}</ul>{tasks.length>MAX_TASKS&&<p className="muted" style={{margin:'8px 0 0'}}>Và {tasks.length-MAX_TASKS} việc khác ở các màn hình tương ứng.</p>}</div>
    :<EmptyState art="tray" title="Bạn đã xử lý hết việc">Việc mới sẽ hiện ở đây khi có tờ trình, đơn mua hoặc hàng cần bổ sung.</EmptyState>}
   </Sheet></div>
   <div className="narrow stack">
    <div className="tray kpi"><span>Giá trị tồn kho</span><strong>{d.inventoryValue===null?'Vượt giới hạn hiển thị':money(d.inventoryValue)}</strong><span>{d.totalProducts} mặt hàng trong danh mục</span></div>
    <div className="tray kpi"><span>Chi tiêu tháng này</span><strong>{spend?.value===null?'Vượt giới hạn hiển thị':money(spend?.value||0)}</strong><span>Tổng các đơn mua, đã gồm VAT</span></div>
    <div className="tray kpi"><span>Đơn mua đang thực hiện</span><strong>{number(d.activeOrders)}</strong><span>{d.totalSuppliers} nhà cung cấp</span></div>
   </div>
  </div>

  <div className="columns">
   <Section className="wide" title="Chi tiêu theo tháng" description={data.demoMode?'Đơn mua và lịch sử mô phỏng trong hệ thống demo.':'Tổng tiền các đơn mua theo tháng tạo đơn, đã gồm VAT.'}>
    {months.length>=3?<div role="img" aria-label={`Biểu đồ chi tiêu ${months.length} tháng, từ ${months[0].month} đến ${months[months.length-1].month}. Tháng gần nhất ${money(months[months.length-1].value||0)}, cao nhất ${money(peak)}.`}><ResponsiveContainer width="100%" height={270}><AreaChart data={months} margin={{left:-8,right:8}}><defs><linearGradient id="spend" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0B7A69" stopOpacity={.22}/><stop offset="100%" stopColor="#0B7A69" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} stroke="#E3EAE8"/><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fontSize:13,fill:'#4A6068'}} minTickGap={20}/><YAxis axisLine={false} tickLine={false} tick={{fontSize:13,fill:'#4A6068'}} tickFormatter={v=>`${number(Number(v)/1000000)}tr`}/><Tooltip formatter={v=>money(Number(v))}/><Area type="monotone" dataKey="value" name="Chi tiêu" stroke="#0B7A69" strokeWidth={2.5} fill="url(#spend)"/></AreaChart></ResponsiveContainer></div>
    :months.length?<div className="stack">
     <div><div className="spend-chart">{months.map(m=><div key={m.month}>{money(m.value||0)}<i style={{height:Math.max(4,132*(m.value||0)/peak)}}/></div>)}</div><div className="spend-axis">{months.map(m=><span key={m.month}>{m.month.slice(5)}/{m.month.slice(0,4)}</span>)}</div></div>
     <p className="note" style={{margin:0}}>Mới có dữ liệu của {months.length} tháng. Đường xu hướng sẽ hiện khi có từ ba tháng trở lên.</p>
    </div>:<EmptyState art="box" title="Chưa có chi tiêu">Biểu đồ hiện sau khi có đơn mua đầu tiên.</EmptyState>}
   </Section>
   <Section className="narrow" title="Hiệu suất nhà cung cấp" description={data.demoMode?'Điểm đánh giá và lịch sử mô phỏng khi chưa có phản hồi.':'Điểm đánh giá sau các đơn đã nhận đủ; chưa có đánh giá thì dùng điểm uy tín khai báo.'}>
    {suppliers.length?<div className="stack">{suppliers.map((s,i)=><div key={s.supplierId} className="supplier-row"><SupplierAvatar name={s.name}/><div><span>{s.name}</span><Bar value={s.score} className={i?'soft':''}/></div><strong>{number(s.score)}</strong></div>)}</div>
    :<EmptyState art="box" title="Chưa có đánh giá"/>}
   </Section>
  </div>

  {!!restock.length&&<Section title="Cần bổ sung tồn kho" description="Mặt hàng có tồn kho thấp hơn mức tối thiểu hoặc dự báo.">
   {restock.map(r=><div key={r.productId} className="stock-row">
    <div className="with-tile"><GoodsTile name={r.name}/><div className="tile-text"><strong>{r.name}</strong><span className="muted">{r.sku}</span></div></div>
    <div className="stock-gauge"><div><strong className={r.stock<r.minStock?'warning-text':''}>Còn {number(r.stock)} {r.unit}</strong><span className="muted">Tối thiểu {number(r.minStock)}, dự báo {number(r.forecast)}</span></div><Bar className={`lg ${r.stock<r.minStock?'low':''}`} value={100*r.stock/(Math.max(r.stock,r.minStock,1)*1.25)} mark={100*r.minStock/(Math.max(r.stock,r.minStock,1)*1.25)}/></div>
    <span>Đề nghị nhập <strong>{number(r.reorderQuantity)} {r.unit}</strong></span>
    <Button onClick={()=>navigate('inventory')}>Xem tồn kho</Button>
   </div>)}
  </Section>}
 </>;
}
