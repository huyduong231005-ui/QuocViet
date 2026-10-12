import {createHash} from 'node:crypto';

export const TABLES=['users','products','suppliers','prices','requests','rfqs','quotations','ahp_sessions','approvals','orders','receipts','evaluations','agent_runs','agent_steps','history','audit','outbox'] as const;
export type Table=typeof TABLES[number];
export interface RecordData {id:string;createdAt:string;[key:string]:any}
export interface Executor {query(sql:string,values?:any[]):Promise<{rows:any[]}>;exec?(sql:string):Promise<unknown>}
export interface RepositoryActor {id:string;name:string;role:string}
export function tableName(table:Table):Table {if(!TABLES.includes(table))throw new Error(`Unknown table: ${table}`);return table}
export function safeNumber(value:unknown,integer=false):number {
 if(typeof value!=='number'&&typeof value!=='string'&&typeof value!=='bigint')throw new Error('Invalid numeric value');
 if(typeof value==='string'&&!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))throw new Error('Invalid numeric value');
 // Compare a string/bigint in decimal arithmetic before Number can round it.
 if(typeof value!=='number'){
  const match=/^(-?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(value))!;
  const exponent=parseInt(match[4]??'0',10);if(Math.abs(exponent)>1000)throw new Error('Numeric exponent exceeds safe finite range');
  const coefficient=BigInt(`${match[2]||'0'}${match[3]??''}`),scale=(match[3]?.length??0)-exponent;
  const numerator=scale<0?coefficient*10n**BigInt(-scale):coefficient,denominator=scale>0?10n**BigInt(scale):1n;
  if(numerator>BigInt(Number.MAX_SAFE_INTEGER)*denominator||(integer&&numerator%denominator!==0n))throw new Error('Numeric value exceeds safe finite range');
 }
 const number=Number(value);
 if(!Number.isFinite(number)||Math.abs(number)>Number.MAX_SAFE_INTEGER||(integer&&!Number.isSafeInteger(number)))throw new Error('Numeric value exceeds safe finite range');
 return number;
}
export function isoTimestamp(value:unknown):string {
 const date=value instanceof Date?value:new Date(String(value));
 if(!Number.isFinite(date.getTime()))throw new Error('Invalid timestamp');
 return date.toISOString();
}
export function calendarDate(value:unknown):string {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value)throw new Error('Invalid calendar date');
 return value;
}
export function canonicalJson(value:unknown):string {
 if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Invalid JSON number');
 if(value===null||typeof value!=='object'){const json=JSON.stringify(value);if(json===undefined)throw new Error('Invalid JSON value');return json}
 if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
 const object=value as Record<string,unknown>;
 return `{${Object.keys(object).filter(key=>object[key]!==undefined).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}
export const fingerprint=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
/** Kind of record an audited action points at, so audit rows can be filtered
 * and traced back to a document without guessing from the action name. */
export function auditEntityType(action:string):string {
 if(action.startsWith('catalog:'))return ({products:'product',suppliers:'supplier',prices:'price'} as Record<string,string>)[action.split(':')[1]]??'catalog';
 if(action.startsWith('tool:')||action==='startAgent')return 'agent_run';
 return ({request:'request',requestApprove:'approval',decide:'approval',approval2:'approval',rfq:'rfq',quotation:'quotation',quotationUpdate:'quotation',ahp:'ahp_session',order:'order',send:'outbox',receipt:'receipt',evaluation:'evaluation'} as Record<string,string>)[action]??'unknown';
}
