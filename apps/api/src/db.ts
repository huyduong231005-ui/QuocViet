import {PGlite} from '@electric-sql/pglite';
import {Pool,PoolClient} from 'pg';
import {cp,mkdir} from 'node:fs/promises';
import {basename,dirname,join} from 'node:path';
import {Repository} from './database/repository';
import {Executor} from './database/contracts';
import {migrateAll,migrateEmbedded,needsMigration,verifySchema,MIGRATION_LOCK} from './database/migrate';
export {Repository} from './database/repository';
export {TABLES,Table,RecordData,Executor} from './database/contracts';

export interface TransactionOptions {readOnly?:boolean;isolation?:'READ COMMITTED'|'REPEATABLE READ';statementTimeoutMs?:number;lockTimeoutMs?:number;idleTransactionTimeoutMs?:number}
/** `migrations` overrides the migration directory; tests use it to add versions. */
export interface OpenOptions {migrations?:string}
// Deadlock victim and serialization failure: PostgreSQL rolled the transaction
// back and asks for it to be run again. Business transactions call no outside
// service, so repeating one is safe.
const RETRYABLE=new Set(['40P01','40001']),RETRIES=2;
const pause=()=>new Promise(resolve=>setTimeout(resolve,20+Math.random()*100));
const poolFor=(connectionString:string)=>new Pool({connectionString,max:10,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:15000,lock_timeout:5000,idle_in_transaction_session_timeout:15000});
function timeout(value:number|undefined,fallback:number){const result=value??fallback;if(!Number.isSafeInteger(result)||result<1||result>300000)throw new Error('Invalid transaction timeout');return result}
async function configure(executor:Executor,options:TransactionOptions){
 const isolation=options.isolation??'READ COMMITTED';
 if(!['READ COMMITTED','REPEATABLE READ'].includes(isolation))throw new Error('Unsupported transaction isolation');
 await executor.query(`SET TRANSACTION ISOLATION LEVEL ${isolation} ${options.readOnly?'READ ONLY':'READ WRITE'}`);
 await executor.query("SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true),set_config('idle_in_transaction_session_timeout',$3,true)",[String(timeout(options.statementTimeoutMs,15000)),String(timeout(options.lockTimeoutMs,5000)),String(timeout(options.idleTransactionTimeoutMs,15000))]);
}
export class Database {
 private queue:Promise<void>=Promise.resolve();private closed=false;
 private constructor(private embedded?:PGlite,private pool?:Pool){}
 static async open(path:string,databaseUrl?:string,options:OpenOptions={}){
  if(databaseUrl){
   const pool=poolFor(databaseUrl);
   try{await verifySchema(pool,options.migrations);return new Database(undefined,pool)}catch(error){await pool.end();throw error}
  }
  const onDisk=path!==':memory:';
  if(onDisk)await mkdir(dirname(path),{recursive:true});
  let pg=new PGlite(onDisk?path:undefined);
  try{
   await pg.waitReady;
   // An embedded database migrates itself on open. When that would convert or
   // upgrade existing data, keep a copy of the directory first: unlike native
   // PostgreSQL there is no separate backup step in front of this one.
   if(onDisk&&await needsMigration(pg,options.migrations)){
    await pg.close();
    await cp(path,join(dirname(path),'backups',`${basename(path)}-${new Date().toISOString().replace(/[:.]/g,'-')}`),{recursive:true});
    pg=new PGlite(path);await pg.waitReady;
   }
   await migrateEmbedded(pg,options.migrations);return new Database(pg);
  }catch(error){if(!pg.closed)await pg.close();throw error}
 }
 /** Explicit administrative entry point. Native runtime startup never executes
  * DDL and requires the last known version with matching checksums. */
 static async migrate(databaseUrl:string,options:OpenOptions={}){
  const pool=poolFor(databaseUrl);
  try{
   await migrateAll(async fn=>{
    const client:PoolClient=await pool.connect();
    try{
     await client.query('BEGIN');
     await client.query("SELECT set_config('statement_timeout','120000',true),set_config('lock_timeout','30000',true)");
     await client.query('SELECT pg_advisory_xact_lock($1)',[MIGRATION_LOCK]);
     const done=await fn(client);await client.query('COMMIT');return done;
    }catch(error){try{await client.query('ROLLBACK')}catch{/* Preserve the original migration error. */}throw error}
    finally{client.release()}
   },options.migrations);
  }finally{await pool.end()}
 }
 async transaction<T>(fn:(repo:Repository)=>Promise<T>,options:TransactionOptions={}):Promise<T>{
  if(this.closed)throw new Error('Database is closed');
  // Native reads take a snapshot and no lock: they do not wait behind writes.
  if(this.pool&&options.readOnly)return this.native(fn,options);
  // Retain the write queue and global write guard until every service write
  // follows the business lock order. PGlite has one embedded connection.
  let release!:()=>void;const previous=this.queue;this.queue=new Promise(resolve=>release=resolve);await previous;
  try{
   if(this.embedded)return await this.embedded.transaction(async tx=>{await configure(tx,options);return fn(new Repository(tx))});
   return await this.native(fn,options);
  }finally{release()}
 }
 private async native<T>(fn:(repo:Repository)=>Promise<T>,options:TransactionOptions):Promise<T>{
  for(let attempt=0;;attempt++){
   const client=await this.pool!.connect();
   try{
    await client.query('BEGIN');await configure(client,options);
    // ponytail: one global lock, so writes run one at a time (reads do not wait). Scoped row locks in a fixed order (spec section 7) if write throughput matters.
    if(!options.readOnly)await client.query('SELECT pg_advisory_xact_lock(714290611)');
    const value=await fn(new Repository(client));await client.query('COMMIT');return value;
   }catch(error:any){
    try{await client.query('ROLLBACK')}catch{/* Preserve the transaction error. */}
    if(attempt>=RETRIES||!RETRYABLE.has(error?.code))throw error;
   }finally{client.release()}
   await pause();
  }
 }
 async close(){if(this.closed)return;this.closed=true;await this.queue;if(this.embedded)await this.embedded.close();if(this.pool)await this.pool.end()}
}
