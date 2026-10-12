import { createContext, useContext, useCallback, useState, useEffect, type ReactNode } from 'react';
import { App } from 'antd';
import type { Bootstrap, User } from './types';
interface Auth {token:string;user:User;}
interface Workspace { auth:Auth | null; data:Bootstrap | null; loading:boolean; error:string; login:(email:string,password:string)=>Promise<void>; logout:()=>void; reload:()=>Promise<void>; request:<T>(path:string,body?:unknown,method?:string)=>Promise<T>; mutate:<T>(path:string,body?:unknown,method?:string)=>Promise<T | undefined>; download:(type:'pdf'|'excel')=>Promise<void>; busy:boolean; }
const Context = createContext<Workspace | null>(null);
const readAuth = ():Auth | null => { try { return JSON.parse(sessionStorage.getItem('procureiq-auth') || 'null') as Auth | null; } catch { return null; } };
export function WorkspaceProvider({children}:{children:ReactNode}) {
  const { message } = App.useApp();
  const [auth,setAuth]=useState<Auth | null>(readAuth); const [data,setData]=useState<Bootstrap | null>(null);
  const [loading,setLoading]=useState(false);const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const logout = useCallback(()=>{sessionStorage.removeItem('procureiq-auth');setAuth(null);setData(null);setError('');},[]);
  const request = useCallback(async <T,>(path:string,body?:unknown,method = body === undefined ? 'GET' : 'POST'):Promise<T> => {
    const response=await fetch(`/api${path}`,{method,headers:{...(body !== undefined ? {'Content-Type':'application/json'} : {}),...(auth ? {Authorization:`Bearer ${auth.token}`} : {})},...(body !== undefined ? {body:JSON.stringify(body)} : {})});
    if (!response.ok) { let detail='Không thể kết nối dịch vụ.'; try {const problem=await response.json() as {message?:string|string[]}; detail=Array.isArray(problem.message)?problem.message.join(' · '):problem.message || detail;}catch{detail=`Lỗi dịch vụ (${response.status})`;} if(response.status===401 && path!=='/auth/login') logout(); throw new Error(detail); }
    if(response.status===204) return undefined as T;
    return response.json() as Promise<T>;
  },[auth,logout]);
  const reload=useCallback(async()=>{if(!auth)return;setLoading(true);try{const result=await request<Bootstrap>('/bootstrap');setData(result);setError('');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setLoading(false);}},[auth,request]);
  useEffect(()=>{void reload();},[reload]);
  const login=async(email:string,password:string)=>{const result=await request<Auth>('/auth/login',{email,password});sessionStorage.setItem('procureiq-auth',JSON.stringify(result));setAuth(result);};
  const mutate=async<T,>(path:string,body?:unknown,method?:string):Promise<T|undefined>=>{setBusy(true);try{const result=await request<T>(path,body,method);message.success('Đã lưu thay đổi');await reload();return result;}catch(e){message.error(e instanceof Error?e.message:String(e));return undefined;}finally{setBusy(false);}};
  const download=async(type:'pdf'|'excel')=>{setBusy(true);try{const response=await fetch(`/api/reports/${type}`,{headers:{Authorization:`Bearer ${auth?.token || ''}`}});if(!response.ok)throw new Error('Không xuất được báo cáo. Vui lòng thử lại.');const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`ProcureIQ-${new Date().toISOString().slice(0,10)}.${type==='excel'?'xlsx':'pdf'}`;link.click();URL.revokeObjectURL(url);message.success('Đã xuất báo cáo');}catch(e){message.error(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  return <Context.Provider value={{auth,data,loading,error,login,logout,reload,request,mutate,download,busy}}>{children}</Context.Provider>;
}
export function useWorkspace(){const value=useContext(Context);if(!value)throw new Error('Workspace context missing');return value;}
