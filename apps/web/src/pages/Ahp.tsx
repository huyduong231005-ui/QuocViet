import { useMemo, useState } from 'react';
import { Alert, App, Button, Input, InputNumber, Modal, Select, Space, Table, Tag } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, CalculatorOutlined, CheckOutlined } from '@ant-design/icons';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from 'recharts';
import { useWorkspace } from '../api';
import { can, eligibleSession, reciprocal, isCurrentQuotation, reorderMatrix } from '../logic';
import { Bar, Chip, EmptyState, PageTitle, Section, Sheet, Status, SupplierAvatar, date, day, money, number, percent, shortId, statusLabel } from '../components';
import { ScaleArt } from '../illustrations';
import type { Criterion, Session } from '../types';
const defaults:Criterion[]=[{id:'price',name:'Giá',type:'cost'},{id:'quality',name:'Chất lượng',type:'benefit'},{id:'delivery',name:'Giao hàng',type:'cost'},{id:'reputation',name:'Uy tín',type:'benefit'}];
const ones=(n:number)=>Array.from({length:n},()=>Array<number>(n).fill(1));
const leaves=(nodes:Criterion[]):Criterion[]=>nodes.flatMap(n=>n.children?.length?leaves(n.children):[n]);
const replaceNode=(nodes:Criterion[],id:string,change:(node:Criterion)=>Criterion):Criterion[]=>nodes.map(n=>n.id===id?change(n):n.children?{...n,children:replaceNode(n.children,id,change)}:n);
/** The consistency ratio a comparison may reach and still be used. */
const CR_LIMIT=0.1;
/** A cell is tinted by how strongly its row outweighs its column, so the matrix reads at a glance. */
const strength=(v:number)=>v===1?'s1':v<1?'':v<=3?'s2':v<=6?'s3':'s4';
function Matrix({criteria,matrix,onChange,disabled}:{criteria:Criterion[];matrix:number[][];onChange:(m:number[][])=>void;disabled?:boolean}){
 const scale=[1/9,1/8,1/7,1/6,1/5,1/4,1/3,1/2,1,2,3,4,5,6,7,8,9].map(v=>({value:v,label:v<1?`1/${Math.round(1/v)}`:String(v)}));
 return <div className="matrix-scroll"><table className="matrix"><thead><tr><th>Hàng so với cột</th>{criteria.map(c=><th key={c.id}>{c.name}</th>)}</tr></thead><tbody>{criteria.map((c,i)=><tr key={c.id}><th>{c.name}</th>{criteria.map((d,j)=>{const v=matrix[i]?.[j]??1;return <td key={d.id} className={i===j?'same':strength(v)}>{i===j?'1':i<j?<Select aria-label={`So sánh ${c.name} và ${d.name}`} variant="borderless" disabled={disabled} options={scale} value={v} onChange={next=>onChange(reciprocal(matrix,i,j,next))}/>:v<1?`1/${Math.round(1/v)}`:number(v)}</td>;})}</tr>)}</tbody></table></div>;
}
function TreeRows({nodes,onChange,onMatrix,disabled,depth=0}:{nodes:Criterion[];onChange:(v:Criterion[])=>void;onMatrix:(id:string)=>void;disabled:boolean;depth?:number}){return <div>{nodes.map((n,i)=><div key={n.id} className="criterion-node"><div className="criterion-row" style={{paddingLeft:depth*18}}><span className="criterion-number">{depth?'↳':i+1}</span><Input aria-label={`Tên tiêu chí ${i+1}`} value={n.name} disabled={disabled} onChange={e=>onChange(nodes.map(v=>v.id===n.id?{...v,name:e.target.value}:v))}/><Tag>{n.children?'Nhóm':n.type==='cost'?'Chi phí':'Lợi ích'}</Tag>{n.children&&<Button size="small" onClick={()=>onMatrix(n.id)}>Ma trận</Button>}<Button size="small" type="text" icon={<ArrowUpOutlined aria-hidden/>} disabled={disabled||i===0} aria-label={`Đưa ${n.name} lên`} onClick={()=>{const copy=[...nodes];[copy[i-1],copy[i]]=[copy[i],copy[i-1]];onChange(copy);}}/><Button size="small" type="text" icon={<ArrowDownOutlined aria-hidden/>} disabled={disabled||i===nodes.length-1} aria-label={`Đưa ${n.name} xuống`} onClick={()=>{const copy=[...nodes];[copy[i],copy[i+1]]=[copy[i+1],copy[i]];onChange(copy);}}/></div>{n.children&&<TreeRows nodes={n.children} depth={depth+1} disabled={disabled} onMatrix={onMatrix} onChange={v=>onChange(nodes.map(c=>c.id===n.id?{...c,children:v,matrix:reorderMatrix(c.matrix||ones(v.length),c.children?.map(n=>n.id)||[],v.map(n=>n.id))}:c))}/>}</div>)}</div>;}
export function AhpPage({navigate}:{navigate:(p:string)=>void}){
 const {data,auth,mutate,busy}=useWorkspace();const {message}=App.useApp();const [rfqId,setRfqId]=useState<string|undefined>(()=>sessionStorage.getItem('procureiq-rfq')||undefined);const [tree,setTree]=useState<Criterion[]>(defaults);const [matrix,setMatrix]=useState<number[][]>(ones(4));const [groupId,setGroupId]=useState<string|null>(null);const [iterations,setIterations]=useState(1000);const [seed,setSeed]=useState(42);const [sessionId,setSessionId]=useState<string>();const [criterionId,setCriterionId]=useState('price');const [jsonOpen,setJsonOpen]=useState(false);const [jsonText,setJsonText]=useState('');
 const selectedGroup=useMemo(()=>{const all=(nodes:Criterion[]):Criterion[]=>nodes.flatMap(n=>[n,...(n.children?all(n.children):[])]);return all(tree).find(n=>n.id===groupId);},[tree,groupId]);
 if(!data||!auth)return null;const buy=can(auth.user.role,'buy');const sessions=data.ahpSessions.filter(s=>!rfqId||s.rfqId===rfqId);const session=sessions.find(s=>s.id===sessionId)||[...sessions].reverse()[0];const flat=session?.flattenedCriteria||leaves(session?.criteria||tree);const supplierName=(id:string)=>data.suppliers.find(s=>s.id===id)?.name||shortId(id);const productName=(id:string)=>data.products.find(p=>p.id===id)?.name||shortId(id);const approval=session?data.approvals.find(a=>a.sessionId===session.id&&a.gate===2):undefined;// With no RFQ picked yet, the screen shows the latest session and works on that session's RFQ.
 const shownRfq=rfqId||session?.rfqId;const validQuotes=data.quotations.filter(q=>q.rfqId===shownRfq&&isCurrentQuotation(q.validUntil,data.businessDate)&&data.suppliers.find(s=>s.id===q.supplierId)?.active);
 const weight=(id:string,i:number)=>session?(Array.isArray(session.weights)?session.weights[i]:(session.weights[id]||0)):0;
 const series=session?.sensitivity.filter(s=>s.criterionId===criterionId).map(s=>({weight:s.weight,...Object.fromEntries(s.ranking.map(r=>[r.supplierId,r.score]))}))||[];
 const setPreset=(grouped:boolean)=>{setTree(grouped?[{id:'operations',name:'Chi phí & vận hành',children:[defaults[0],defaults[2]],matrix:ones(2)},{id:'assurance',name:'Chất lượng & đối tác',children:[defaults[1],defaults[3]],matrix:ones(2)}]:defaults);setMatrix(ones(grouped?2:4));setGroupId(null);};
 const applyJson=()=>{try{const parsed=JSON.parse(jsonText) as Criterion[];if(!Array.isArray(parsed)||!parsed.length)throw new Error('Cây phải là một danh sách tiêu chí.');const ids=leaves(parsed).map(c=>c.id).sort();if(ids.join(',')!=='delivery,price,quality,reputation')throw new Error('Cây phải chứa đúng 4 nguồn: price, quality, delivery, reputation; không lặp.');const verify=(nodes:Criterion[])=>{nodes.forEach(n=>{if(!n.id||!n.name)throw new Error('Mỗi nút cần id và name.');if(n.children){if(!n.children.length)throw new Error('Nhóm phải có tiêu chí con.');verify(n.children);n.matrix=n.matrix||ones(n.children.length);}});};verify(parsed);setTree(parsed);setMatrix(ones(parsed.length));setGroupId(null);setJsonOpen(false);}catch(e){message.error(e instanceof Error?e.message:String(e));}};

 const rfq=data.rfqs.find(q=>q.id===shownRfq);
 const winRate=(supplierId:string)=>session?.monteCarlo.winProbabilities.find(p=>p.supplierId===supplierId)?.probability||0;
 const [leader,runnerUp]=session?.ranking||[];
 const snapshots=session?.quotationSnapshots||[];
 // The best value in each column of the quotations: cheapest, fastest, highest quality.
 const best={price:Math.min(...snapshots.map(q=>q.unitPrice*(1+q.vat/100))),days:Math.min(...snapshots.map(q=>q.deliveryDays)),quality:Math.max(...snapshots.map(q=>q.qualityScore))};
 const mark=(isBest:boolean,text:string)=>isBest&&snapshots.length>1?<span className="best">{text}<span className="sr-only"> (tốt nhất)</span></span>:text;
 const steps=[
  {label:'Chọn yêu cầu báo giá',note:rfq?`${productName(rfq.productId)}, ${validQuotes.length} báo giá còn hiệu lực`:'Chưa chọn',state:rfq?'done':'now'},
  {label:'So sánh tiêu chí',note:session?(session.consistent?'Đã tính, nhất quán':'Đã tính, chưa nhất quán'):'Chưa tính',state:session?'done':rfq?'now':''},
  {label:'Xem kết quả',note:leader?`${leader.supplierName||supplierName(leader.supplierId)} dẫn đầu`:'Chưa có kết quả',state:session?'done':''},
  {label:'Trình duyệt',note:approval?`${statusLabel(approval.status)}${approval.decidedAt?` ngày ${day(approval.decidedAt)}`:''}`:'Chưa gửi duyệt',state:approval?.status==='approved'?'done':session?'now':''},
 ];

 return <>
  <PageTitle title="So sánh nhà cung cấp bằng AHP" description="So sánh theo tiêu chí, kiểm tra độ nhất quán và xem lựa chọn có đứng vững khi số liệu dao động." actions={session&&buy?<><Button disabled={session.status==='stale'||!session.consistent||!!approval||data.orders.some(o=>o.items.some(line=>line.sessionId===session.id))} loading={busy} onClick={()=>mutate(`/ahp/sessions/${session.id}/request-approval`,{})}>Gửi duyệt lựa chọn</Button><Button type="primary" disabled={!eligibleSession(session,approval?.status==='approved')||data.orders.some(o=>o.items.some(line=>line.rfqId===session.rfqId))} loading={busy} onClick={async()=>{if(await mutate('/orders',{sessionId:session.id}))navigate('orders');}}>Tạo đơn mua</Button></>:undefined}/>
  <section className="tray stack">
   <div className="filter-strip"><label htmlFor="ahp-rfq"><strong>Yêu cầu báo giá đang so sánh</strong></label><Select id="ahp-rfq" showSearch optionFilterProp="label" style={{flex:'1 1 320px',maxWidth:520}} placeholder="Chọn một yêu cầu báo giá" value={shownRfq} options={data.rfqs.map(q=>({label:`${shortId(q.id)}, ${productName(q.productId)}`,value:q.id}))} onChange={v=>{setRfqId(v);setSessionId(undefined);sessionStorage.setItem('procureiq-rfq',v);}}/></div>
   <ol className="steps" aria-label="Các bước so sánh">{steps.map((step,i)=><li key={step.label} className={step.state}><i aria-hidden="true">{step.state==='done'?<CheckOutlined aria-hidden/>:i+1}</i><span><strong><span className="sr-only">{step.state==='done'?'Đã xong: ':step.state==='now'?'Đang làm: ':'Chưa tới: '}</span>{step.label}</strong><small>{step.note}</small></span></li>)}</ol>
  </section>

  <div className="columns">
   <Section className="narrow" title="Cây tiêu chí" description="Bốn nguồn dữ liệu; tên nhóm và thứ tự có thể chỉnh sửa." actions={buy?<Button size="small" onClick={()=>{setJsonText(JSON.stringify(tree,null,2));setJsonOpen(true);}}>Chỉnh cấu trúc</Button>:undefined}>
    <Space size="small" wrap className="preset-actions"><Button size="small" disabled={!buy} onClick={()=>setPreset(false)}>4 tiêu chí</Button><Button size="small" disabled={!buy} onClick={()=>setPreset(true)}>2 nhóm</Button><Button size="small" type={groupId===null?'primary':'default'} onClick={()=>setGroupId(null)}>Ma trận gốc</Button></Space>
    <TreeRows nodes={tree} disabled={!buy} onMatrix={setGroupId} onChange={v=>{setMatrix(reorderMatrix(matrix,tree.map(n=>n.id),v.map(n=>n.id)));setTree(v);}}/>
   </Section>
   <Section className="wide" title={`So sánh cặp${selectedGroup?`: ${selectedGroup.name}`:''}`} description="Tiêu chí ở hàng quan trọng hơn tiêu chí ở cột bao nhiêu lần: 3 vừa, 5 mạnh, 7 rất mạnh, 9 tuyệt đối. Ô càng đậm, mức hơn càng lớn.">
    <Matrix criteria={selectedGroup?.children||tree} matrix={selectedGroup?.matrix||matrix} disabled={!buy} onChange={m=>selectedGroup?setTree(replaceNode(tree,selectedGroup.id,n=>({...n,matrix:m}))):setMatrix(m)}/>
    <div className="compute-controls"><label>Số lượt mô phỏng<InputNumber aria-label="Số lượt Monte Carlo" value={iterations} min={100} max={5000} step={100} disabled={!buy} onChange={v=>setIterations(Number(v)||1000)}/></label><label>Seed<InputNumber aria-label="Seed Monte Carlo" value={seed} precision={0} disabled={!buy} onChange={v=>setSeed(Number(v)||42)}/></label><Button type="primary" icon={<CalculatorOutlined aria-hidden/>} loading={busy} disabled={!buy||!shownRfq||validQuotes.length<2} onClick={async()=>{const result=await mutate<Session>('/ahp/compute',{rfqId:shownRfq,criteria:tree,matrix,iterations,seed});if(result)setSessionId(result.id);}}>Tính AHP</Button></div>
   </Section>
  </div>

  {session&&leader?<>
   <div className="tray session-bar"><Space wrap><strong>Phiên {shortId(session.id)}</strong><Status value={session.status}/><span className="muted">{date(session.createdAt)}, lần tính thứ {session.revision||1}</span></Space><Select aria-label="Chọn phiên AHP" value={session.id} style={{minWidth:280}} options={[...sessions].reverse().map(s=>({label:`${shortId(s.id)}, CR ${number(s.cr)}, ${statusLabel(s.status)}`,value:s.id}))} onChange={setSessionId}/></div>
   {session.status==='stale'&&<Alert type="error" showIcon message="Báo giá đã thay đổi. Phiên này không còn hiệu lực và không thể tạo đơn mua." description="Tính lại AHP rồi gửi duyệt phiên mới."/>}

   <div className="columns">
    <div className="narrow"><Sheet>
     <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}><span className="sheet-kicker"><strong>Nhà cung cấp dẫn đầu</strong></span><Status value={approval?.status||session.status}/></div>
     <ScaleArt/>
     <div className="winner-name"><SupplierAvatar name={leader.supplierName||supplierName(leader.supplierId)}/><h2>{leader.supplierName||supplierName(leader.supplierId)}</h2></div>
     <div className="kpis"><div className="kpi"><span>Điểm tổng hợp</span><strong className="teal">{percent(leader.score)}</strong></div><div className="kpi"><span>Đứng đầu khi mô phỏng</span><strong>{percent(winRate(leader.supplierId))}</strong></div></div>
     <span className="muted">{runnerUp?`Dẫn trước ${runnerUp.supplierName||supplierName(runnerUp.supplierId)} ${number((leader.score-runnerUp.score)*100)} điểm phần trăm. `:''}Mô phỏng {number(session.monteCarlo.iterations)} lượt với nhiễu ±{number((session.monteCarlo.uncertainty??0.15)*100)}%.</span>
    </Sheet></div>
    <Section className="wide" title="Xếp hạng nhà cung cấp" description="Thanh trên là điểm AHP. Thanh dưới là tỷ lệ đứng đầu trong mô phỏng Monte Carlo: độ ổn định của thứ hạng khi số liệu dao động, không phải xác suất lựa chọn đúng tuyệt đối.">
     <div className="stack">{session.ranking.map((r,i)=><div key={r.supplierId} className="rank-row"><span className={`rank-badge ${i===0?'first':''}`}><span className="sr-only">Hạng </span>{i+1}</span><div><strong>{r.supplierName||supplierName(r.supplierId)}</strong><div className="rank-line"><Bar className={`lg ${i?'soft':''}`} value={r.score*100}/><span><span className="sr-only">Điểm AHP </span>{percent(r.score)}</span></div><div className="rank-line"><Bar className="thin" value={winRate(r.supplierId)*100}/><span><span className="sr-only">Đứng đầu khi mô phỏng </span>{percent(winRate(r.supplierId))}</span></div></div></div>)}</div>
    </Section>
   </div>

   <div className="columns">
    <Section className="narrow" title="Trọng số tiêu chí">
     <div className="stack">
      {flat.map((c,i)=><div key={c.id} className="weight-row"><div><span>{c.name}</span><strong>{percent(weight(c.id,i))}</strong></div><Bar value={weight(c.id,i)*100}/></div>)}
      <div className={`consistency ${session.consistent?'':'off'}`}><div><strong>{session.consistent?'So sánh nhất quán':'Cần điều chỉnh ma trận'}</strong><span>CR {session.cr.toFixed(4)}</span></div><Bar value={0} mark={100*session.cr/CR_LIMIT}/><div><span>0</span><span>Ngưỡng cho phép {number(CR_LIMIT)}</span></div></div>
      <span className="muted">CI {session.ci.toFixed(4)}, λmax {session.lambdaMax.toFixed(4)}</span>
      {session.treeConsistency&&session.treeConsistency.length>1&&<div className="group-consistency stack">{session.treeConsistency.map((g,i)=><div key={g.id||g.groupId||i}><span>{g.name||(g.groupId==='root'?'Nhóm gốc':g.groupId)||g.id||`Nhóm ${i+1}`}</span><Chip tone={g.consistent?'done':'stop'}>CR {number(g.cr)}</Chip></div>)}</div>}
     </div>
    </Section>
    <Section className="wide" title="Độ nhạy theo trọng số" description="Đổi trọng số một tiêu chí, các tiêu chí còn lại giữ tỷ lệ tương đối. Chỗ hai đường cắt nhau là nơi thứ hạng đổi." actions={<Select aria-label="Tiêu chí thay đổi" value={criterionId} onChange={setCriterionId} options={flat.map(c=>({label:c.name,value:c.id}))} style={{width:200}}/>}>
    {series.length?<div role="img" aria-label={`Biểu đồ độ nhạy: điểm của ${session.ranking.length} nhà cung cấp khi trọng số ${flat.find(c=>c.id===criterionId)?.name||''} đổi từ 0% đến 100%.`}><ResponsiveContainer width="100%" height={320}><LineChart data={series} margin={{right:25,left:15,top:20}}><CartesianGrid stroke="#E3EAE8"/><XAxis dataKey="weight" tick={{fontSize:13,fill:'#4A6068'}} tickFormatter={v=>percent(Number(v))}/><YAxis tick={{fontSize:13,fill:'#4A6068'}} tickFormatter={v=>percent(Number(v))}/><Tooltip formatter={v=>percent(Number(v))} labelFormatter={v=>`Trọng số ${percent(Number(v))}`}/><Legend/>{session.ranking.map((r,i)=><Line key={r.supplierId} dataKey={r.supplierId} name={r.supplierName||supplierName(r.supplierId)} stroke={['#0B7A69','#2456A6','#C97F0E','#33474E'][i%4]} strokeWidth={2.5} dot={false}/>)}</LineChart></ResponsiveContainer></div>:<EmptyState art="box" title="Chưa có phân tích độ nhạy"/>}
    </Section>
   </div>

   <Section title="Báo giá đã dùng để tính" description="Phiên AHP lưu báo giá tại thời điểm tính; đơn mua lấy đơn giá từ đây. Giá trị tốt nhất ở mỗi cột được tô xanh.">
     <Table rowKey="supplierId" dataSource={snapshots} pagination={false} scroll={{x:'max-content'}} locale={{emptyText:'Phiên này không lưu báo giá'}} columns={[
      {title:'Nhà cung cấp',render:(_,q)=><span className="with-tile"><SupplierAvatar name={supplierName(q.supplierId)}/><strong>{supplierName(q.supplierId)}</strong></span>},
      {title:'Đơn giá sau VAT',align:'right',render:(_,q)=>mark(q.unitPrice*(1+q.vat/100)===best.price,money(q.unitPrice*(1+q.vat/100)))},
      {title:'Giao hàng',align:'right',render:(_,q)=>mark(q.deliveryDays===best.days,`${q.deliveryDays} ngày`)},
      {title:'Chất lượng',align:'right',render:(_,q)=>mark(q.qualityScore===best.quality,number(q.qualityScore))},
      {title:'Hiệu lực đến',align:'right',render:(_,q)=>day(q.validUntil)},
     ]}/>
   </Section>
  </>:<div className="tray"><EmptyState art="mail" title="Chưa có kết quả so sánh">Chọn một yêu cầu báo giá có ít nhất hai báo giá còn hiệu lực rồi bấm Tính AHP.</EmptyState></div>}
  <Modal title="Chỉnh cấu trúc cây tiêu chí" open={jsonOpen} onCancel={()=>setJsonOpen(false)} onOk={applyJson} okText="Áp dụng cấu trúc" cancelText="Hủy" width={700}><Alert type="info" message="Dùng children để nhóm và matrix để so sánh các con. Giữ đủ 4 leaf price, quality, delivery, reputation. Đổi cấu trúc sẽ đặt lại ma trận gốc."/><Input.TextArea className="json-editor" rows={18} value={jsonText} onChange={e=>setJsonText(e.target.value)}/></Modal>
 </>;
}
