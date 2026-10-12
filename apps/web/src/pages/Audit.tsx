import { useState } from 'react';
import { Button, Drawer, Input, Select, Space } from 'antd';
import { FileExcelOutlined, FilePdfOutlined } from '@ant-design/icons';
import { useWorkspace } from '../api';
import { DetailText, DetailValue, PageTitle, date, shortId } from '../components';
import { PagedTable } from '../PagedTable';
import type { Audit } from '../types';

const entityNames:Record<string,string>={product:'Mặt hàng',supplier:'Nhà cung cấp',price:'Giá tham khảo',request:'Nhu cầu',approval:'Phê duyệt',rfq:'RFQ',quotation:'Báo giá',ahp_session:'Phiên AHP',order:'Đơn mua',receipt:'Phiếu nhận',evaluation:'Đánh giá NCC',outbox:'Lệnh gửi PO',user:'Tài khoản',agent_run:'AI Agent'};
export function AuditPage(){
 const {data,download,busy}=useWorkspace();
 const [selected,setSelected]=useState<Audit|null>(null);const [entityType,setEntityType]=useState<string>();const [from,setFrom]=useState('');const [to,setTo]=useState('');
 if(!data)return null;
 return <>
  <PageTitle title="Nhật ký hoạt động" description="Theo dõi thao tác nghiệp vụ, mới nhất ở trên. Lọc theo loại đối tượng và khoảng ngày." actions={<Space><Button icon={<FileExcelOutlined aria-hidden/>} loading={busy} onClick={()=>download('excel')}>Xuất Excel</Button><Button icon={<FilePdfOutlined aria-hidden/>} loading={busy} onClick={()=>download('pdf')}>Xuất PDF</Button></Space>}/>
  <PagedTable<Audit> path="/audit" params={{entityType,from:from||undefined,to:to||undefined}} searchPlaceholder="Tìm theo người, hành động, mã đối tượng..."
   filters={<>
    <Select aria-label="Loại đối tượng" allowClear placeholder="Mọi loại đối tượng" value={entityType} onChange={setEntityType} options={Object.entries(entityNames).map(([value,label])=>({value,label}))} style={{width:190}}/>
    <Input aria-label="Từ ngày" type="date" value={from} max={to||undefined} onChange={e=>setFrom(e.target.value)} style={{width:150}}/>
    <Input aria-label="Đến ngày" type="date" value={to} min={from||undefined} onChange={e=>setTo(e.target.value)} style={{width:150}}/>
   </>}
   columns={[
    {title:'Thời gian',dataIndex:'createdAt',render:date},
    {title:'Hành động',dataIndex:'action',render:v=><strong>{v}</strong>},
    {title:'Người thực hiện',render:(_,a)=>a.actorName||shortId(a.actorId)},
    {title:'Đối tượng',dataIndex:'entityType',render:v=>v?entityNames[v]||v:'Nghiệp vụ'},
    {title:'Mã đối tượng',dataIndex:'entityId',render:shortId},
    {title:'Thao tác',render:(_,a)=><Button type="link" onClick={()=>setSelected(a)}>Chi tiết</Button>},
   ]}/>
  <Drawer title="Chi tiết nhật ký" open={!!selected} onClose={()=>setSelected(null)} width={550}>{selected&&<>
   <DetailValue label="Hành động">{selected.action}</DetailValue>
   <DetailValue label="Thời gian">{date(selected.createdAt)}</DetailValue>
   <DetailValue label="Người thực hiện">{selected.actorName||selected.actorId||'—'}</DetailValue>
   <DetailValue label="Đối tượng">{selected.entityType?entityNames[selected.entityType]||selected.entityType:'—'} {selected.entityId}</DetailValue>
   <div className="inspector-section"><h3>Dữ liệu ghi nhận</h3><DetailText value={selected.detail&&Object.keys(selected.detail as object).length?selected.detail:'Không có chi tiết bổ sung'}/></div>
  </>}</Drawer>
 </>;
}
