import { useState } from 'react';
import { Alert, Button, Drawer, Grid, Input, Select, Space, Table, Tabs } from 'antd';
import { CheckOutlined, CloseOutlined, WarningOutlined } from '@ant-design/icons';
import { useWorkspace } from '../api';
import { can, describeLines } from '../logic';
import { EmptyState, GoodsTile, PageTitle, Seal, Sheet, Status, date, number, percent, shortId } from '../components';
import { PagedTable } from '../PagedTable';
import type { Approval } from '../types';

/** A requested quantity this many times the minimum stock is pointed out to the approver. */
const LARGE_REQUEST_FACTOR=3;
const gateName=(a:Approval)=>a.gate===1?'Điểm duyệt 1: nhu cầu mua':'Điểm duyệt 2: lựa chọn nhà cung cấp';

export function ApprovalsPage(){
 const {data,auth,mutate,busy}=useWorkspace();const wide=!!Grid.useBreakpoint().xl;
 // `stamped` is the approval decided a moment ago: its seal is pressed once, older ones are shown still.
 const [selected,setSelected]=useState<Approval|null>(null);const [stamped,setStamped]=useState<string>();const [comment,setComment]=useState('');const [supplierId,setSupplierId]=useState<string>();const [tab,setTab]=useState('pending');const [gate,setGate]=useState<string>();
 if(!data||!auth)return null;
 const allowed=can(auth.user.role,'approve');
 // The row carries its own lines and reason; the AHP session is in the workspace
 // for anything still open or recent, and may be absent for an old decision.
 const linesOf=(a:Approval)=>describeLines(a.lines||[],data.products);
 const session=data.ahpSessions.find(s=>s.id===selected?.sessionId);
 const view=(a:Approval)=>{setSelected(a);setComment('');setSupplierId(a.supplierId||data.ahpSessions.find(s=>s.id===a.sessionId)?.ranking[0]?.supplierId);};
 // The decided sheet stays in view with its seal; on a narrow screen the drawer closes instead.
 const decide=async(approved:boolean)=>{
  if(!selected)return;
  if(!await mutate(`/approvals/${selected.id}/decide`,{approved,comment,...(approved&&selected.gate===2?{supplierId}:{})}))return;
  if(!wide){setSelected(null);return;}
  setStamped(selected.id);setSelected({...selected,status:approved?'approved':'rejected',comment,decidedAt:new Date().toISOString(),decidedByName:auth.user.name,...(approved&&selected.gate===2?{supplierId}:{})});
 };
 const lines=selected?linesOf(selected):[];
 const stock=lines.map(line=>({line,item:data.inventory.find(i=>i.productId===line.productId)})).filter(row=>row.item);
 const notes=stock.flatMap(({line,item})=>[item!.stock<item!.minStock?`${line.name} đang dưới mức tối thiểu: còn ${number(item!.stock)} ${line.unit}, cần ít nhất ${number(item!.minStock)}.`:`${line.name} còn ${number(item!.stock)} ${line.unit}, trên mức tối thiểu ${number(item!.minStock)}.`,...(item!.minStock>0&&line.quantity>=LARGE_REQUEST_FACTOR*item!.minStock?[`Số lượng đề nghị gấp ${number(Math.round(line.quantity/item!.minStock))} lần mức tối thiểu.`]:[])]);
 const unusual=stock.some(({line,item})=>item!.stock<item!.minStock||item!.minStock>0&&line.quantity>=LARGE_REQUEST_FACTOR*item!.minStock);
 const decided=selected&&selected.status!=='pending';

 const body=selected&&<>
  {decided&&<Seal approved={selected.status==='approved'} at={selected.decidedAt} fresh={stamped===selected.id}/>}
  <header className={`sheet-head ${decided?'sealed':''}`}>
   <span className="sheet-kicker">Tờ trình {shortId(selected.id)}, {gateName(selected).toLowerCase()}</span>
   <h2>{lines.length?lines.map(line=>line.name).join(', '):`Yêu cầu ${shortId(selected.requestId)}`}</h2>
   <span className="sheet-kicker">Yêu cầu {shortId(selected.requestId)}, {selected.runId?`Agent ${shortId(selected.runId)}`:'lập thủ công'}, gửi lúc {date(selected.createdAt)}</span>
  </header>
  {!!lines.length&&<Table rowKey="productId" dataSource={lines} pagination={false} size="small" columns={[
   {title:'Mặt hàng',render:(_,line)=><span className="with-tile"><GoodsTile name={line.name} small/><strong>{line.name}</strong></span>},
   {title:'Đề nghị nhập',align:'right',render:(_,line)=><strong>{number(line.quantity)} {line.unit}</strong>},
   {title:'Tồn hiện tại',align:'right',render:(_,line)=>{const item=data.inventory.find(i=>i.productId===line.productId);return item?<span className={item.stock<item.minStock?'warning-text':''}>{number(item.stock)} {line.unit}</span>:'—';}},
   {title:'Tối thiểu',align:'right',render:(_,line)=>{const item=data.inventory.find(i=>i.productId===line.productId);return item?`${number(item.minStock)} ${line.unit}`:'—';}},
  ]}/>}
  {!!notes.length&&<div className={`note ${unusual?'warn':''}`}><WarningOutlined aria-hidden="true"/><div><strong>Đối chiếu tồn kho</strong>{notes.join(' ')}</div></div>}
  <div><h3>Lý do đề nghị</h3><p style={{margin:0}}>{selected.reason||'—'}</p></div>
  {selected.gate===2&&<>
   <div><h3>Tờ trình</h3><p className="proposal-text" style={{margin:0}}>{selected.proposal||'Không có tờ trình.'}</p></div>
   {session?<>
    {session.status==='stale'&&<Alert type="error" message="Phiên AHP đã cũ. Cần tính và duyệt lại." showIcon/>}
    <Table rowKey="supplierId" dataSource={session.ranking} pagination={false} size="small" columns={[
     {title:'Nhà cung cấp',dataIndex:'supplierName'},
     {title:'Điểm AHP',dataIndex:'score',align:'right',render:percent},
     {title:'Đứng đầu khi mô phỏng',align:'right',render:(_,r)=>percent(session.monteCarlo.winProbabilities.find(p=>p.supplierId===r.supplierId)?.probability||0)},
    ]}/>
    <span className="muted">Phiên AHP {shortId(session.id)}, CR {session.cr.toFixed(4)}</span>
   </>:<p className="note" style={{margin:0}}>Bảng xếp hạng của phiên AHP này không còn trong không gian làm việc; tờ trình ở trên ghi lại kết quả.</p>}
  </>}
  {selected.status==='pending'&&allowed?<div className="decision-form sheet-rule">
   {selected.gate===2&&<><label htmlFor="approval-supplier">Nhà cung cấp được chọn</label><Select id="approval-supplier" aria-label="Nhà cung cấp được chọn" value={supplierId} onChange={setSupplierId} options={(session?.quotationSnapshots||[]).map(q=>({value:q.supplierId,label:data.suppliers.find(s=>s.id===q.supplierId)?.name||shortId(q.supplierId)}))} style={{width:'100%'}}/></>}
   <label htmlFor="approval-comment">Nhận xét{selected.gate===2&&supplierId!==session?.ranking[0]?.supplierId?' (bắt buộc khi chọn nhà cung cấp khác đề xuất)':''}</label>
   <Input.TextArea id="approval-comment" aria-label="Nhận xét quyết định" value={comment} onChange={e=>setComment(e.target.value)} rows={3} placeholder="Nêu căn cứ phê duyệt hoặc lý do từ chối…"/>
   <Space wrap className="decision-actions">
    <Button type="primary" icon={<CheckOutlined aria-hidden/>} loading={busy} disabled={selected.gate===2&&(!supplierId||!session?.consistent||session.status==='stale'||(supplierId!==session.ranking[0]?.supplierId&&!comment.trim()))} onClick={()=>void decide(true)}>Phê duyệt</Button>
    <Button danger icon={<CloseOutlined aria-hidden/>} loading={busy} disabled={!comment.trim()} onClick={()=>void decide(false)}>Từ chối</Button>
   </Space>
   {!comment.trim()&&<span className="muted">Nhập nhận xét để từ chối.</span>}
  </div>:<div className="sheet-rule"><h3>Quyết định</h3>
   {selected.status==='pending'?<p className="muted" style={{margin:0}}>Đang chờ quản lý quyết định.</p>:<div>
    <p style={{margin:'0 0 4px'}}><strong>{selected.status==='approved'?'Đã duyệt':'Đã từ chối'}</strong> bởi {selected.decidedByName||shortId(selected.decidedBy)} lúc {date(selected.decidedAt)}.</p>
    {selected.gate===2&&selected.supplierId&&<p style={{margin:'0 0 4px'}}>Nhà cung cấp được chọn: <strong>{data.suppliers.find(s=>s.id===selected.supplierId)?.name||shortId(selected.supplierId)}</strong></p>}
    <p style={{margin:0}}>{selected.comment||'Không có nhận xét.'}</p>
   </div>}
  </div>}
 </>;

 return <>
  <PageTitle title="Hộp thư phê duyệt" description="Xác nhận nhu cầu và lựa chọn nhà cung cấp trước khi tạo đơn mua."/>
  <Tabs activeKey={tab} onChange={key=>{setTab(key);setSelected(null);}} items={[{key:'pending',label:`Chờ duyệt (${data.dashboard.pendingApprovals})`},{key:'history',label:'Lịch sử quyết định'}]}/>
  {!allowed&&<Alert type="info" showIcon message="Quyền phê duyệt thuộc Quản lý và Quản trị viên. Bạn có thể xem mọi quyết định."/>}
  <div className="split read">
   <div className="split-list"><PagedTable<Approval> key={tab} path="/list/approvals" params={{status:tab==='pending'?'pending':'decided',gate}} searchPlaceholder="Tìm theo mã, nội dung tờ trình, nhận xét…"
    onRows={rows=>{if(wide&&!selected&&rows.length)view(rows[0]);}}
    empty={tab==='pending'&&!gate?<EmptyState art="tray" title="Không còn tờ trình nào chờ duyệt" action={<Button onClick={()=>{setTab('history');setSelected(null);}}>Xem lịch sử quyết định</Button>}>Các quyết định đã đưa ra nằm trong lịch sử.</EmptyState>:undefined}
    filters={<Select aria-label="Điểm kiểm soát" allowClear placeholder="Cả hai điểm duyệt" value={gate} onChange={setGate} options={[{value:'1',label:'Điểm 1: nhu cầu mua'},{value:'2',label:'Điểm 2: lựa chọn nhà cung cấp'}]} style={{width:250}}/>}
    card={a=>{const own=linesOf(a);return <button type="button" className="doc-card" aria-pressed={selected?.id===a.id} onClick={()=>view(a)}>
     <span className="doc-head"><Status value={a.status}/><span className="muted">{gateName(a)}</span></span>
     <strong>{own.length?own.map(line=>line.name).join(', '):`Yêu cầu ${shortId(a.requestId)}`}</strong>
     <span className="muted">{[own.map(line=>`${number(line.quantity)} ${line.unit}`).join(', '),a.reason].filter(Boolean).join('. ')}</span>
     <span className="muted">{shortId(a.id)}, {a.runId?'AI Agent':'lập thủ công'}, {date(a.createdAt)}</span>
    </button>;}}/></div>
   {wide&&<div className="split-detail"><div className="sr-only" role="status">{selected?`${stamped===selected.id?(selected.status==='approved'?'Đã duyệt':'Đã từ chối'):'Đang xem'} tờ trình ${shortId(selected.id)}: ${lines.map(line=>line.name).join(', ')}`:''}</div><Sheet label="Tờ trình đang xem">{body||<EmptyState art="tray" title="Chọn một tờ trình">Nội dung, đối chiếu tồn kho và phần quyết định hiện ở đây.</EmptyState>}</Sheet></div>}
  </div>
  {!wide&&<Drawer title={selected?gateName(selected):''} width={600} open={!!selected} onClose={()=>setSelected(null)}><div className="sheet-plain">{body}</div></Drawer>}
 </>;
}
