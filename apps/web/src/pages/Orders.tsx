import { useEffect, useState } from 'react';
import { Alert, Button, Drawer, Grid, Select, Space, Table, Tabs } from 'antd';
import { MailOutlined, InboxOutlined, StarOutlined, ShoppingCartOutlined, RobotOutlined } from '@ant-design/icons';
import { useWorkspace } from '../api';
import { can, poCandidates } from '../logic';
import { Bar, Chip, DataTable, Editor, EmptyState, GoodsTile, PageTitle, Sheet, Status, SupplierAvatar, date, money, number, shortId, type Field } from '../components';
import { PagedTable } from '../PagedTable';
import { ReceiptEditor } from './ReceiptEditor';
import { EmailDraftModal } from './EmailDraftModal';
import type { Evaluation, Order, Receipt } from '../types';

const evaluationFields:Field[]=[{name:'qualityScore',label:'Chất lượng / 100',kind:'number',min:1,max:100},{name:'serviceScore',label:'Dịch vụ / 100',kind:'number',min:1,max:100},{name:'notes',label:'Nhận xét',kind:'textarea',required:false}];
const statusOptions=[{value:'ordered',label:'Đã đặt'},{value:'partially_received',label:'Nhận một phần'},{value:'received',label:'Đã nhận đủ'}];
/** Lines of different products have different units, so progress is shown per line or as a count of lines. */
const progress=(order:Order)=>order.items.length===1?`Đã nhận ${number(order.items[0].receivedQuantity)} trên ${number(order.items[0].quantity)} ${order.items[0].unit}`:`${order.items.filter(line=>line.receivedQuantity===line.quantity).length} trên ${order.items.length} dòng đã nhận đủ`;
/** Share of the order received, as the average of its lines: quantities in different units are never added. */
const received=(order:Order)=>100*order.items.reduce((sum,line)=>sum+line.receivedQuantity/line.quantity,0)/order.items.length;
const receivedLines=(receipt:Receipt)=>receipt.items.map(item=><div key={item.id}>{item.productName||shortId(item.productId)}: {number(item.quantity)} / {number(item.acceptedQuantity)} {item.unit}</div>);

/** Deliveries of one PO, read when its detail opens. */
function OrderReceipts({orderId}:{orderId:string}){
 const {request}=useWorkspace();const [rows,setRows]=useState<Receipt[]>([]);const [loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;setLoading(true);request<{rows:Receipt[]}>(`/list/receipts?orderId=${encodeURIComponent(orderId)}&pageSize=100`).then(page=>{if(active)setRows(page.rows);}).catch(()=>{if(active)setRows([]);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[orderId,request]);
 return <Table rowKey="id" dataSource={rows} loading={loading} pagination={false} size="small" locale={{emptyText:'Chưa có đợt giao nào'}} columns={[
  {title:'Ngày nhận',dataIndex:'receivedAt',render:date},
  {title:'Giao / đạt',render:(_,r)=>receivedLines(r)},
  {title:'Ghi chú',dataIndex:'notes'},
 ]}/>;
}

export function OrdersPage(){
 const {data,auth,mutate,busy}=useWorkspace();const wide=!!Grid.useBreakpoint().xl;
 // The lists are paged on the server, so a chosen row is kept as the row itself.
 const [selected,setSelected]=useState<Order|null>(null);const [receiving,setReceiving]=useState<Order|null>(null);const [evaluating,setEvaluating]=useState<Order|null>(null);const [status,setStatus]=useState<string>();
 const [draftOrder,setDraftOrder]=useState<Order|null>(null);
 if(!data||!auth)return null;
 const buy=can(auth.user.role,'buy'),receive=can(auth.user.role,'receive');
 const supplierName=(id?:string)=>data.suppliers.find(s=>s.id===id)?.name||shortId(id);
 const mailed=(o:Order)=>o.sentAt?<Chip tone="idle" icon={<MailOutlined aria-hidden/>}>{data.mailEnabled?'Đã gửi thư':'Đã xếp gửi'} {date(o.sentAt)}</Chip>:<Chip tone="wait" icon={<MailOutlined aria-hidden/>}>Chưa gửi thư</Chip>;
 // Approved sessions waiting for a PO, grouped by the supplier that was chosen.
 const candidates=poCandidates(data.ahpSessions,data.approvals,data.rfqs).map(group=>({...group,id:group.supplierId,lines:group.sessionIds.map(sessionId=>{
  const rfq=data.rfqs.find(q=>q.id===data.ahpSessions.find(s=>s.id===sessionId)!.rfqId)!,product=data.products.find(p=>p.id===rfq.productId);
  return {sessionId,name:product?.name||shortId(rfq.productId),unit:product?.unit||'',quantity:rfq.quantity};
 })}));
 // An action changes the PO. Beside the list its sheet is refreshed from the reloaded page;
 // in the drawer it is closed rather than left showing old numbers.
 const act=async(path:string,body:unknown)=>{const saved=await mutate(path,body);if(saved&&!wide)setSelected(null);return !!saved;};
 const actions=(o:Order)=><Space wrap>
  {buy&&(
   <Button icon={<RobotOutlined aria-hidden />} onClick={()=>setDraftOrder(o)}>Xem / AI soạn thư PO</Button>
  )}
  {buy&&!o.sentAt&&(
   <Button type="primary" icon={<MailOutlined aria-hidden/>} loading={busy} onClick={()=>void act(`/orders/${o.id}/send`,{})}>Gửi PO kèm PDF</Button>
  )}
  {receive&&o.status!=='received'&&<Button type={buy&&!o.sentAt?'default':'primary'} icon={<InboxOutlined aria-hidden/>} onClick={()=>setReceiving(o)}>Ghi nhận nhập hàng</Button>}
  {buy&&o.status==='received'&&!o.evaluated&&<Button type="primary" icon={<StarOutlined aria-hidden/>} onClick={()=>setEvaluating(o)}>Đánh giá nhà cung cấp</Button>}
 </Space>;
 /** Where this PO stands on the purchase line. */
 const journey=(o:Order)=>{
  const requests=[...new Set(o.items.map(line=>line.requestId))],reason=data.requests.find(r=>r.id===requests[0])?.reason;
  return [
   {state:'done',label:`Nhu cầu ${requests.map(shortId).join(', ')}`,note:[reason,'Đã duyệt.'].filter(Boolean).join('. ')},
   {state:'done',label:'Báo giá và so sánh AHP',note:`${o.items.length} mặt hàng, lựa chọn nhà cung cấp đã được duyệt.`},
   {state:o.sentAt?'done':'now',label:`Đơn mua ${shortId(o.id)}`,note:o.sentAt?`Đã gửi cho nhà cung cấp lúc ${date(o.sentAt)}.`:'Chưa gửi cho nhà cung cấp.'},
   {state:o.status==='received'?'done':o.sentAt||o.status==='partially_received'?'now':'todo',label:'Nhận hàng',note:`${progress(o)}.`},
   {state:o.evaluated?'done':o.status==='received'?'now':'todo',label:'Đánh giá nhà cung cấp',note:o.evaluated?'Đã đánh giá.':o.status==='received'?'Đang chờ đánh giá.':'Mở sau khi nhận đủ hàng.'},
  ];
 };
 const body=selected&&<>
  <header className="sheet-head"><span className="sheet-kicker">Đơn đặt hàng</span><h2>PO {shortId(selected.id)}</h2><span className="sheet-kicker">{supplierName(selected.supplierId)}, lập lúc {date(selected.createdAt)}</span></header>
  <Space wrap><Status value={selected.status}/>{mailed(selected)}{selected.evaluated&&<Chip tone="done" icon={<StarOutlined aria-hidden/>}>Đã đánh giá</Chip>}</Space>
  <div>
   {selected.items.map(line=><div key={line.id} className="line-row">
    <div><GoodsTile name={line.productName} small/><span className="tile-text"><strong>{line.productName}</strong><span className="muted">{number(line.quantity)} {line.unit} × {money(line.unitPrice)}, VAT {line.vat}%, giao trong {line.deliveryDays} ngày</span></span><strong>{money(line.total)}</strong></div>
    <div className="line-progress"><Bar className={line.receivedQuantity<line.quantity?'moving':''} value={100*line.receivedQuantity/line.quantity}/><span>Đã nhận {number(line.receivedQuantity)}/{number(line.quantity)}, đạt {number(line.acceptedQuantity)}</span></div>
   </div>)}
   <div className="sheet-total"><span>Tổng cộng đã gồm VAT</span><strong>{money(selected.total)}</strong></div>
  </div>
  {actions(selected)}
  <div className="sheet-rule"><h3>Hành trình chứng từ</h3><ol className="journey">{journey(selected).map(step=><li key={step.label} className={step.state}><span className="dot" aria-hidden="true"/><span className="step"><strong><span className="sr-only">{step.state==='done'?'Đã xong: ':step.state==='now'?'Đang làm: ':'Chưa tới: '}</span>{step.label}</strong><span>{step.note}</span></span></li>)}</ol></div>
  <div className="sheet-rule"><h3>Các đợt giao hàng</h3><OrderReceipts orderId={selected.id}/></div>
 </>;
 return <>
  <PageTitle title="Đơn mua và nhập kho" description="Đơn mua dùng báo giá đã duyệt, có thể gồm nhiều mặt hàng của cùng một nhà cung cấp. Nhập hàng theo từng đợt và đánh giá sau khi nhận đủ."/>
  <Tabs defaultActiveKey={candidates.length&&buy?'candidates':'orders'} items={[
   ...(buy?[{key:'candidates',label:`Chờ lập PO (${candidates.length})`,children:<>
    <Alert type="info" showIcon message="Các lựa chọn đã được duyệt của cùng một nhà cung cấp được gộp thành một đơn mua, mỗi mặt hàng một dòng."/>
    <DataTable rows={candidates} searchPlaceholder="Tìm nhà cung cấp, mặt hàng…" columns={[
     {title:'Nhà cung cấp',render:(_,g)=><span className="with-tile"><SupplierAvatar name={supplierName(g.supplierId)}/><strong>{supplierName(g.supplierId)}</strong></span>},
     {title:'Mặt hàng đã duyệt',render:(_,g)=>g.lines.map(line=><div key={line.sessionId}>{line.name}: {number(line.quantity)} {line.unit}</div>)},
     {title:'Thao tác',render:(_,g)=><Button type="primary" icon={<ShoppingCartOutlined aria-hidden/>} loading={busy} onClick={()=>mutate('/orders',{sessionIds:g.sessionIds})}>Lập PO ({g.lines.length} dòng)</Button>},
    ]}/>
   </>}]:[]),
   {key:'orders',label:'Đơn mua',children:<div className="split">
    <div className="split-list"><PagedTable<Order> path="/list/orders" params={{status}} searchPlaceholder="Tìm theo mã PO, nhà cung cấp, mặt hàng…"
     // The sheet beside the list follows the reloaded row, so an action shows its result at once.
     onRows={rows=>{const same=rows.find(row=>row.id===selected?.id);if(same)setSelected(same);else if(wide&&!selected&&rows.length)setSelected(rows[0]);}}
     empty={status?undefined:<EmptyState art="box" title="Chưa có đơn mua">Đơn mua xuất hiện sau khi lựa chọn nhà cung cấp được duyệt.</EmptyState>}
     filters={<Select aria-label="Trạng thái đơn mua" allowClear placeholder="Mọi trạng thái" value={status} onChange={setStatus} options={statusOptions} style={{width:180}}/>}
     card={o=><button type="button" className="doc-card" aria-pressed={selected?.id===o.id} onClick={()=>setSelected(o)}>
      <span className="doc-head"><strong>PO {shortId(o.id)}</strong><Status value={o.status}/>{mailed(o)}{o.evaluated&&<Chip tone="done" icon={<StarOutlined aria-hidden/>}>Đã đánh giá</Chip>}</span>
      <span className="with-tile"><SupplierAvatar name={supplierName(o.supplierId)}/><span className="tile-text"><span style={{fontWeight:600}}>{supplierName(o.supplierId)}</span><span className="muted">{o.items.map(line=>line.productName).join(', ')}</span></span><span className="doc-money">{money(o.total)}</span></span>
      <span className="doc-progress"><Bar className={o.status==='received'?'':'moving'} value={received(o)}/><span>{progress(o)}</span></span>
     </button>}/></div>
    {wide&&<div className="split-detail"><div className="sr-only" role="status">{selected?`Đang xem PO ${shortId(selected.id)}, ${supplierName(selected.supplierId)}`:''}</div><Sheet label="Đơn mua đang xem">{body||<EmptyState art="box" title="Chọn một đơn mua">Các dòng hàng, tiến độ nhận và hành trình chứng từ hiện ở đây.</EmptyState>}</Sheet></div>}
   </div>},
   {key:'receipts',label:'Phiếu nhập',children:<PagedTable<Receipt> path="/list/receipts" searchPlaceholder="Tìm theo mã PO, nhà cung cấp, ghi chú…" columns={[
    {title:'Phiếu nhập',dataIndex:'id',render:shortId},
    {title:'Đơn mua',dataIndex:'orderId',render:shortId},
    {title:'Nhà cung cấp',render:(_,r)=>supplierName(r.supplierId)},
    {title:'Ngày nhận',dataIndex:'receivedAt',render:date},
    {title:'Giao / đạt theo mặt hàng',render:(_,r)=>receivedLines(r)},
    {title:'Ghi chú',dataIndex:'notes'},
    {title:'Khóa chống lặp',dataIndex:'idempotencyKey',render:v=><span className="mono">{shortId(v)}</span>},
   ]}/>},
   {key:'evaluations',label:'Đánh giá nhà cung cấp',children:<>
    <Alert type="info" showIcon message="Điểm đạt và điểm giao hàng do hệ thống tính. Với đơn nhiều mặt hàng, mỗi dòng được tính theo giá trị đặt trước VAT, không cộng số lượng khác đơn vị."/>
    <PagedTable<Evaluation> path="/list/evaluations" searchPlaceholder="Tìm theo mã PO, nhà cung cấp, nhận xét…" columns={[
     {title:'Đơn mua',dataIndex:'orderId',render:shortId},
     {title:'Nhà cung cấp',render:(_,e)=>supplierName(e.supplierId)},
     {title:'Giao hàng',dataIndex:'deliveryScore',render:number},
     {title:'Chất lượng',dataIndex:'qualityScore',render:number},
     {title:'Dịch vụ',dataIndex:'serviceScore',render:number},
     {title:'Tổng điểm',dataIndex:'overallScore',render:v=><strong className="teal">{number(v)}</strong>},
     {title:'Nhận xét',dataIndex:'notes'},
     {title:'Ngày tạo',dataIndex:'createdAt',render:date},
    ]}/>
   </>},
  ]}/>
  <ReceiptEditor order={receiving} supplierName={receiving?supplierName(receiving.supplierId):''} onClose={()=>setReceiving(null)} onSave={body=>act('/receipts',body)}/>
  <Editor title="Đánh giá nhà cung cấp" open={!!evaluating} onClose={()=>setEvaluating(null)} initial={{qualityScore:80,serviceScore:80,notes:''}} fields={evaluationFields} onSave={async v=>!!evaluating&&act('/evaluations',{...v,orderId:evaluating.id})}>
   {evaluating&&<Alert type="info" showIcon message={`PO ${shortId(evaluating.id)}, ${supplierName(evaluating.supplierId)}`} description="Điểm giao hàng do hệ thống tính từ thời gian nhận. Phản hồi sẽ được dùng trong lần AHP tiếp theo."/>}
  </Editor>
  {!wide&&<Drawer title="Chi tiết đơn mua" width={720} open={!!selected} onClose={()=>setSelected(null)}><div className="sheet-plain">{body}</div></Drawer>}
  <EmailDraftModal
   open={!!draftOrder}
   onClose={()=>setDraftOrder(null)}
   context={draftOrder ? {
    type: 'po',
    orderId: draftOrder.id,
    supplierName: supplierName(draftOrder.supplierId),
    supplierEmail: data.suppliers.find(s=>s.id===draftOrder.supplierId)?.email,
    suppliers: (() => {
      const sup = data.suppliers.find(s=>s.id===draftOrder.supplierId);
      return sup ? [{id: sup.id, name: sup.name, email: sup.email, phone: sup.phone}] : undefined;
    })(),
    productName: draftOrder.items.map(l=>l.productName).join(', '),
    quantity: draftOrder.items[0]?.quantity,
    unit: draftOrder.items[0]?.unit,
   } : null}
   onSend={async ()=>{
    await act(`/orders/${draftOrder!.id}/send`, {});
   }}
   sendLabel="Gửi PO kèm PDF"
  />
 </>;
}
