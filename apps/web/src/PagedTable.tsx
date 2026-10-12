import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Input, Pagination, Space, Spin, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SearchOutlined } from '@ant-design/icons';
import { useWorkspace } from './api';
import { EmptyState } from './components';

interface Page<T> {rows:T[];total:number;page:number;pageSize:number}
/** A list whose search, filters and paging run on the server: only the page
 * on screen is fetched. `params` are extra query filters; changing them, or the
 * search text, returns to the first page. It refetches when the workspace
 * reloads, so a change made elsewhere shows up here. Rows are drawn as a table
 * (`columns`) or, for documents, as one block each (`card`). `onRows` reports
 * each page as it arrives. Pass `empty` only while no filter of yours is set. */
export function PagedTable<T extends {id:string}>({path,columns,card,params={},searchPlaceholder='Tìm kiếm…',filters,empty,onRows}:{path:string;columns?:ColumnsType<T>;card?:(row:T)=>ReactNode;params?:Record<string,string|undefined>;searchPlaceholder?:string;filters?:ReactNode;empty?:ReactNode;onRows?:(rows:T[])=>void}){
 const {request,data}=useWorkspace();
 const [page,setPage]=useState(1);const [pageSize,setPageSize]=useState(10);const [search,setSearch]=useState('');const [term,setTerm]=useState('');
 const [result,setResult]=useState<Page<T>|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [attempt,setAttempt]=useState(0);
 const filterKey=JSON.stringify(params);
 const report=useRef(onRows);report.current=onRows;
 // Wait for a pause in typing before asking the server.
 useEffect(()=>{const timer=setTimeout(()=>{setTerm(search.trim());setPage(1);},300);return()=>clearTimeout(timer);},[search]);
 useEffect(()=>{setPage(1);},[filterKey]);
 useEffect(()=>{
  let active=true;setLoading(true);
  const query=new URLSearchParams({page:String(page),pageSize:String(pageSize)});
  if(term)query.set('search',term);
  for(const [name,value] of Object.entries(JSON.parse(filterKey) as Record<string,string|undefined>))if(value)query.set(name,value);
  request<Page<T>>(`${path}?${query}`).then(next=>{if(active){setResult(next);setError('');report.current?.(next.rows);}}).catch(e=>{if(active)setError(e instanceof Error?e.message:String(e));}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[path,page,pageSize,term,filterKey,request,data,attempt]);
 const rows=result?.rows??[];
 // `empty` is the caller's message for a list with nothing in it; a search that finds nothing says so instead.
 const nothing=empty&&!term?empty:<EmptyState art="box" title={term||Object.values(params).some(Boolean)?'Không có kết quả phù hợp':'Chưa có dữ liệu'}/>;
 const paging={current:page,pageSize,total:result?.total??0,showSizeChanger:true,pageSizeOptions:[10,20,50,100],onChange:(nextPage:number,nextSize:number)=>{setPage(nextSize===pageSize?nextPage:1);setPageSize(nextSize);}};
 return <div className="table-tray">
  <div className="table-toolbar">
   <Space wrap><Input prefix={<SearchOutlined aria-hidden/>} allowClear placeholder={searchPlaceholder} value={search} onChange={e=>setSearch(e.target.value)} style={{width:300,maxWidth:'100%'}}/>{filters}</Space>
   <span className="muted">{result?`${result.total} dòng`:''}</span>
  </div>
  {error&&<Alert type="error" showIcon message="Không tải được danh sách" description={error} action={<Button onClick={()=>setAttempt(n=>n+1)}>Thử lại</Button>}/>}
  {card?<Spin spinning={loading}>{rows.length?<ul className="doc-list">{rows.map(row=><li key={row.id}>{card(row)}</li>)}</ul>:!loading&&nothing}{(result?.total??0)>pageSize&&<Pagination {...paging} style={{margin:'16px 0 8px',justifyContent:'flex-end'}}/>}</Spin>
  :<Table<T> rowKey="id" columns={columns} dataSource={rows} loading={loading} scroll={{x:'max-content'}} pagination={{...paging,hideOnSinglePage:false}} locale={{emptyText:nothing}}/>}
 </div>;
}
