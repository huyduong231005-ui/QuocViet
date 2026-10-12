import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { SelectProps } from 'antd';
import { CheckOutlined, ClockCircleOutlined, CloseOutlined, MinusOutlined, PlusOutlined, SearchOutlined, SyncOutlined } from '@ant-design/icons';
import { EmptyArt, GoodsGlyph } from './illustrations';
export const money = (n:number) => new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(Number(n)||0);
export const number = (n:number) => new Intl.NumberFormat('vi-VN',{maximumFractionDigits:2}).format(Number(n)||0);
export const percent = (n:number) => `${number(n*100)}%`;
export const date = (value?:string) => value ? new Date(value).toLocaleString('vi-VN',{dateStyle:'short',timeStyle:'short'}) : '—';
export const day = (value?:string) => value ? new Date(value).toLocaleDateString('vi-VN') : '—';
export const roleNames:Record<string,string>={admin:'Quản trị viên',buyer:'Thu mua',manager:'Quản lý',warehouse:'Kho',auditor:'Kiểm toán'};
export const shortId = (id?:string) => id ? id.slice(0,8).toUpperCase() : '—';
const labels:Record<string,string>={pending:'Chờ duyệt',approved:'Đã duyệt',rejected:'Từ chối',cancelled:'Đã hủy',open:'Đang mở',closed:'Đã có PO',pending_approval:'Chờ duyệt lựa chọn',partially_received:'Nhận một phần',ready_to_order:'Sẵn sàng tạo PO',denied:'Bị chặn',draft:'Bản nháp',stale:'Cần tính lại',ordered:'Đã đặt',partial:'Nhận một phần',received:'Đã nhận đủ',completed:'Hoàn tất',starting:'Khởi động',waiting_approval_1:'Chờ duyệt nhu cầu',collecting:'Thu thập báo giá',waiting_approval_2:'Chờ duyệt lựa chọn',error:'Có lỗi',success:'Thành công',sent:'Đã gửi',running:'Đang chạy'};
export const statusLabel=(value:string)=>labels[value]||value;

/** Five tones, each with its own icon, so a status never depends on colour alone:
 * waiting on a person, in progress, finished, refused or failed, and not started. */
export type Tone='wait'|'doing'|'done'|'stop'|'idle';
const toneIcons:Record<Tone,ReactNode>={wait:<ClockCircleOutlined aria-hidden/>,doing:<SyncOutlined aria-hidden/>,done:<CheckOutlined aria-hidden/>,stop:<CloseOutlined aria-hidden/>,idle:<MinusOutlined aria-hidden/>};
const toneOf=(value:string):Tone=>['approved','completed','received','success','sent','closed'].includes(value)?'done':['rejected','error','stale','denied'].includes(value)?'stop':['pending','pending_approval','waiting_approval_1','waiting_approval_2'].includes(value)?'wait':['starting','collecting','running','partial','partially_received','ordered','open','ready_to_order'].includes(value)?'doing':'idle';
export function Chip({tone,icon,children}:{tone:Tone;icon?:ReactNode;children:ReactNode}){return <span className={`status-chip ${tone}`}>{icon??toneIcons[tone]}{children}</span>;}
export function Status({value}:{value:string}){return <Chip tone={toneOf(value)}>{labels[value]||value}</Chip>;}

export function PageTitle({title,description,actions}:{title:string;description:string;actions?:ReactNode}){return <div className="page-title"><div><h1>{title}</h1><p>{description}</p></div>{actions&&<Space wrap>{actions}</Space>}</div>;}
/** A tray: the flat surface for tables, charts and lists. */
export function Section({title,description,actions,children,className=''}:{title:string;description?:string;actions?:ReactNode;children:ReactNode;className?:string}){return <section className={`work-section ${className}`}><div className="section-head"><div><h2>{title}</h2>{description&&<p>{description}</p>}</div>{actions}</div>{children}</section>;}
/** A sheet: the raised, stacked surface for one document or one decision. */
export function Sheet({children,className='',label}:{children:ReactNode;className?:string;label?:string}){return <div className="sheet-stack"><article className={`sheet ${className}`} aria-label={label}>{children}</article></div>;}
/** The decision stamped on a sheet; `fresh` presses it once, for a decision just made. The words next to it say the same thing for screen readers. */
export function Seal({approved,at,fresh}:{approved:boolean;at?:string;fresh?:boolean}){return <div className={`seal ${approved?'round':'box'} ${fresh?'':'still'}`} aria-hidden="true"><span>{approved?'ĐÃ DUYỆT':'TỪ CHỐI'}</span><small>{day(at)}</small></div>;}
export function GoodsTile({name,small}:{name:string;small?:boolean}){return <span className={`tile goods ${small?'sm':''}`} aria-hidden="true"><GoodsGlyph name={name}/></span>;}
/** A supplier is shown by the initials of the last two words of its name. */
export function SupplierAvatar({name}:{name:string}){return <span className="avatar" aria-hidden="true">{name.trim().split(/\s+/).slice(-2).map(word=>word[0]).join('').toUpperCase()}</span>;}
/** `value` and `mark` are percentages of the track; `mark` draws a threshold line. */
export function Bar({value,mark,className=''}:{value:number;mark?:number;className?:string}){const clamp=(n:number)=>Math.max(0,Math.min(100,Number.isFinite(n)?n:0));return <div className={`bar ${className}`}><i style={{width:`${clamp(value)}%`}}/>{mark!==undefined&&<b style={{left:`${clamp(mark)}%`}}/>}</div>;}
/** An empty list says what belongs there and, when there is one, the next step. */
export function EmptyState({art,title,children,action}:{art:'tray'|'mail'|'box';title:string;children?:ReactNode;action?:ReactNode}){return <div className="empty-state"><EmptyArt kind={art}/><strong>{title}</strong>{children&&<span>{children}</span>}{action}</div>;}

/** A Select for a form row. The form marks a required control with aria-required, and Ant Design's
 * searchable Select puts that on a wrapper where ARIA does not allow it; the row's label already
 * carries the required mark. */
export function FormSelect({'aria-required':_required,...props}:SelectProps&{'aria-required'?:unknown}){return <Select {...props}/>;}
export function DataTable<T extends {id?:string;productId?:string}>({rows,columns,searchPlaceholder='Tìm kiếm…',rowKey,extra}:{rows:T[];columns:ColumnsType<T>;searchPlaceholder?:string;rowKey?:string;extra?:ReactNode}){
 const [query,setQuery]=useState('');const normalized=query.toLocaleLowerCase('vi');const filtered=rows.filter(r=>JSON.stringify(r).toLocaleLowerCase('vi').includes(normalized));
 return <div className="table-tray"><div className="table-toolbar"><Input prefix={<SearchOutlined aria-hidden/>} allowClear placeholder={searchPlaceholder} value={query} onChange={e=>setQuery(e.target.value)} style={{maxWidth:320}}/><Space>{extra}<span className="muted">{filtered.length} dòng</span></Space></div><Table<T> rowKey={rowKey||'id'} columns={columns} dataSource={filtered} scroll={{x:'max-content'}} pagination={{pageSize:8,hideOnSinglePage:true,showSizeChanger:true}} locale={{emptyText:<EmptyState art="box" title={query?'Không có kết quả phù hợp':'Chưa có dữ liệu'}/>}}/></div>;
}
export interface Field {name:string;label:string;kind?:'number'|'select'|'multi'|'text'|'textarea'|'switch'|'date'|'datetime'|'password';required?:boolean;min?:number;max?:number;precision?:number;options?:{label:string;value:string}[];dependsOn?:string;optionsByValue?:Record<string,{label:string;value:string}[]>;help?:string;disabled?:boolean;}
export function Editor({title,open,onClose,fields,initial,onSave,children,submitLabel='Lưu'}:{title:string;open:boolean;onClose:()=>void;fields:Field[];initial?:Record<string,unknown>;onSave:(v:Record<string,unknown>)=>Promise<boolean>;children?:ReactNode;submitLabel?:string}){
 const [form]=Form.useForm<Record<string,unknown>>();const [saving,setSaving]=useState(false);
 const initialized=useRef(false);
 const values=Form.useWatch([],form)||initial||{};
 useEffect(()=>{
  if(!open){initialized.current=false;return;}
  // Capture initial values only when opening. Parent reloads and failed saves must retain the draft.
  if(initialized.current)return;
  initialized.current=true;
  form.resetFields();
  Object.entries(initial||{}).forEach(([name,value])=>form.setFieldValue(name,value));
 },[open,initial,form]);
 useEffect(()=>{
  if(!open)return;
  for(const field of fields){
   if(!field.dependsOn)continue;
   const selected=form.getFieldValue(field.name) as unknown;
   const choices=field.optionsByValue?.[String(form.getFieldValue(field.dependsOn)||'')]||[];
   if(selected!==undefined&&!choices.some(option=>option.value===selected))form.setFieldValue(field.name,undefined);
  }
 },[open,fields,values,form]);
 const optionsFor=(field:Field)=>field.dependsOn?field.optionsByValue?.[String(values[field.dependsOn]||'')]||[]:field.options;
 const save=async()=>{try{const values=await form.validateFields();setSaving(true);if(await onSave(values))onClose();}catch{/* field validation rendered by Form */}finally{setSaving(false);}};
 return <Modal title={title} open={open} onCancel={onClose} onOk={()=>void save()} confirmLoading={saving} okText={submitLabel} cancelText="Hủy" width={570} destroyOnHidden><Form name="workspace-editor" form={form} layout="vertical" className="editor-form">{children}{fields.map(f=><Form.Item key={f.name} name={f.name} label={f.label} valuePropName={f.kind==='switch'?'checked':'value'} extra={f.help} rules={[{required:f.required ?? true,message:`Vui lòng nhập ${f.label.toLowerCase()}`}]}>{f.kind==='number'?<InputNumber aria-label={f.label} precision={f.precision} min={f.min ?? 0} max={f.max} style={{width:'100%'}} disabled={f.disabled}/>:f.kind==='select'||f.kind==='multi'?<FormSelect mode={f.kind==='multi'?'multiple':undefined} options={optionsFor(f)} showSearch optionFilterProp="label" placeholder={f.dependsOn&&!values[f.dependsOn]?"Chọn RFQ trước":"Chọn..."} disabled={f.disabled||!!f.dependsOn&&!values[f.dependsOn]}/>:f.kind==='textarea'?<Input.TextArea aria-label={f.label} rows={3} disabled={f.disabled}/>:f.kind==='switch'?<Switch aria-label={f.label} disabled={f.disabled}/>:f.kind==='password'?<Input.Password aria-label={f.label} autoComplete="new-password" disabled={f.disabled}/>:<Input aria-label={f.label} type={f.kind==='date'?'date':f.kind==='datetime'?'datetime-local':'text'} disabled={f.disabled}/>}</Form.Item>)}</Form></Modal>;
}
export function PermissionNote(){return <Alert type="info" showIcon message="Tài khoản hiện tại có quyền xem màn hình này."/>;}
export function AddButton({children,onClick}:{children:ReactNode;onClick:()=>void}){return <Button type="primary" icon={<PlusOutlined aria-hidden/>} onClick={onClick}>{children}</Button>;}
export function DetailValue({label,children}:{label:string;children:ReactNode}){return <div className="detail-value"><span>{label}</span><strong>{children}</strong></div>;}
export function DetailText({value}:{value:unknown}){return <Typography.Paragraph className="detail-json">{typeof value==='string'?value:JSON.stringify(value,null,2)}</Typography.Paragraph>;}
