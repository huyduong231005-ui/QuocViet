import {config} from 'dotenv';
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {chmodSync,copyFileSync,existsSync,mkdirSync,readFileSync,renameSync,statSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Client} from 'pg';
import {parse} from 'pg-connection-string';
import {Database} from '../db';
import {TABLES} from './contracts';
import {RECONCILIATION} from './legacy';
import {NORMALIZED_TABLES,migrationDefinitions} from './schema';
import {Procurement} from '../procurement';
import {readCatalog,writeSampleCatalog} from '../catalog-import';
import {DEFAULT_ROLES,provisionRoles,runtimeUrl} from './roles';
import {seedDemo} from './demo';

/** Administrative database commands. Connection strings come from the local
 * .env (or TEST_DATABASE_URL for the rehearsal cluster) and reach PostgreSQL
 * tools through the child environment: no secret is printed or put on a
 * command line. */
const root=resolve(__dirname,'../../../..');
config({path:resolve(root,'.env'),quiet:true});

interface Snapshot {database:string;port:string;server:string;state:'empty'|'legacy'|'migrated'|'unknown';counts:Record<string,number>;adminDigest?:string;versions:string[]}
const BUSINESS=TABLES.filter(table=>table!=='users');
// npm runs this in apps/api; a file argument is relative to where the user typed the command.
const userPath=(file:string)=>resolve(process.env.INIT_CWD??process.cwd(),file);
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
function required(name:string):string {const value=process.env[name];if(!value)throw new Error(`${name} is not configured`);return value}
function toolEnvironment(url:string):NodeJS.ProcessEnv {
 const target=parse(url);
 return {...process.env,PGHOST:target.host??'127.0.0.1',PGPORT:String(target.port??5432),PGUSER:target.user??'',PGPASSWORD:target.password??'',PGDATABASE:target.database??''};
}
function tool(name:string):string {
 const directory=process.env.PG_BIN??['18','17','16'].map(version=>`C:/Program Files/PostgreSQL/${version}/bin`).find(existsSync);
 if(!directory)throw new Error('PostgreSQL client tools not found; set PG_BIN');
 return resolve(directory,process.platform==='win32'?`${name}.exe`:name);
}
/** Dumps and saved configuration hold password hashes and connection secrets:
 * only this user, SYSTEM and Administrators may open them. The groups are named
 * by SID because their display names differ between Windows languages. */
function restrict(file:string){
 if(process.platform!=='win32'){chmodSync(file,0o600);return}
 const result=spawnSync('icacls',[file,'/inheritance:r','/grant:r',`${process.env.USERNAME}:F`,'*S-1-5-18:F','*S-1-5-32-544:F'],{encoding:'utf8'});
 if(result.status!==0)throw new Error(`Could not restrict access to ${file}`);
}
function run(name:string,args:string[],url:string){
 const result=spawnSync(tool(name),args,{env:toolEnvironment(url),encoding:'utf8'});
 if(result.status!==0)throw new Error(`${name} failed: ${(result.stderr||result.error?.message||'').trim().split('\n').slice(-3).join(' | ')}`);
}
async function connected<T>(url:string,fn:(client:Client)=>Promise<T>):Promise<T> {
 const client=new Client({connectionString:url});await client.connect();
 try{return await fn(client)}finally{await client.end()}
}
async function snapshot(url:string):Promise<Snapshot> {
 return connected(url,async client=>{
  await client.query('BEGIN TRANSACTION READ ONLY');
  const meta=(await client.query("SELECT current_database() database,current_setting('port') port,current_setting('server_version') server")).rows[0];
  const tables=(await client.query("SELECT table_schema,table_name FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_schema IN ('public','procurement','legacy_json_v1')")).rows;
  const names=(schema:string)=>tables.filter(t=>t.table_schema===schema).map(t=>t.table_name).sort();
  const same=(actual:string[],expected:readonly string[])=>actual.length===expected.length&&[...expected].sort().every((name,index)=>name===actual[index]);
  const state=!tables.length?'empty':same(names('public'),TABLES)&&!names('procurement').length?'legacy':same(names('procurement'),NORMALIZED_TABLES)&&!names('public').length?'migrated':'unknown';
  const counts:Record<string,number>={};let adminDigest:string|undefined,versions:string[]=[];
  if(state==='legacy'){
   for(const table of TABLES)counts[table]=(await client.query(`SELECT count(*)::int count FROM public.${table}`)).rows[0].count;
   adminDigest=(await client.query("SELECT data->>'passwordHash' hash FROM public.users WHERE data->>'role'='admin' ORDER BY id LIMIT 1")).rows[0]?.hash;
  }else if(state==='migrated'){
   for(const table of TABLES)counts[table]=(await client.query(`SELECT count(*)::int count FROM procurement.${table}`)).rows[0].count;
   adminDigest=(await client.query("SELECT password_hash hash FROM procurement.users WHERE role='admin' ORDER BY id LIMIT 1")).rows[0]?.hash;
   versions=(await client.query('SELECT version,name FROM procurement.schema_migrations ORDER BY version')).rows.map(row=>`${row.version}:${row.name}`);
  }
  await client.query('ROLLBACK');
  // Only a digest of the stored hash leaves this function, for equality checks.
  return {...meta,state,counts,adminDigest:adminDigest?digest(adminDigest):undefined,versions};
 });
}
function describe(label:string,s:Snapshot){
 const business=BUSINESS.reduce((sum,table)=>sum+(s.counts[table]??0),0);
 console.log(`${label}: database=${s.database} port=${s.port} server=${s.server} state=${s.state} users=${s.counts.users??0} businessRecords=${business}${s.versions.length?` migrations=${s.versions.join(',')}`:''}`);
}
function backup(url:string):string {
 const directory=resolve(root,'.data/backups');mkdirSync(directory,{recursive:true});
 const file=resolve(directory,`${parse(url).database}-${new Date().toISOString().replace(/[:.]/g,'-')}.dump`);
 run('pg_dump',['--format=custom','--no-password','--file',file],url);
 if(statSync(file).size<1)throw new Error('Backup file is empty');
 restrict(file);
 return file;
}
/** Restore the dump into a throwaway database on the rehearsal cluster and run
 * the real migration there first. */
async function rehearse(file:string,source:Snapshot){
 const adminUrl=required('TEST_DATABASE_URL'),name=`quocviet_rehearsal_${randomBytes(6).toString('hex')}`;
 const target=new URL(adminUrl);target.pathname=`/${name}`;const url=target.toString();
 await connected(adminUrl,client=>client.query(`CREATE DATABASE ${name}`));
 try{
  run('pg_restore',['--no-owner','--no-privileges','--no-password','--exit-on-error','--dbname',name,file],url);
  const restored=await snapshot(url);
  if(restored.state!==source.state||JSON.stringify(restored.counts)!==JSON.stringify(source.counts)||restored.adminDigest!==source.adminDigest)throw new Error('Restored backup differs from its source');
  console.log('backup restore verified: table counts and administrator hash match the source');
  if(source.state!=='empty'){
   await Database.migrate(url);await verifyMigrated(url,source);
   console.log('rehearsal migration verified on the restored copy');
  }
 }finally{await connected(adminUrl,client=>client.query(`DROP DATABASE ${name} WITH (FORCE)`))}
}
async function verifyMigrated(url:string,before:Snapshot){
 const after=await snapshot(url);
 if(after.state!=='migrated')throw new Error(`Database is ${after.state} after migration`);
 if(after.adminDigest!==before.adminDigest)throw new Error('Administrator password hash changed');
 for(const table of TABLES)if(after.counts[table]!==(before.counts[table]??0))throw new Error(`Record count changed: ${table}`);
 await connected(url,async client=>{
  for(const [name,sql] of Object.entries(RECONCILIATION))if((await client.query(sql)).rows.length)throw new Error(`Reconciliation failed: ${name}`);
  const legacy=(await client.query("SELECT count(*)::int count FROM information_schema.tables WHERE table_schema='legacy_json_v1'")).rows[0].count;
  if(before.state==='legacy'&&legacy!==TABLES.length)throw new Error('Legacy tables were not retained');
 });
 // The runtime entry point must accept the result without running DDL.
 await (await Database.open(':memory:',url)).close();
 return after;
}
async function main(){
 // The demo story is written into whatever the application itself would open: the
 // embedded database when DATABASE_URL is not set, PostgreSQL otherwise.
 if(process.argv[2]==='demo'){
  const db=await Database.open(process.env.DATA_DIR||resolve(root,'.data/postgres'),process.env.DATABASE_URL);
  try{for(const line of await seedDemo(db,process.env.DEMO_MODE!=='false'))console.log(line)}finally{await db.close()}
  return;
 }
 // DATABASE_URL is what the API runs as. Once a runtime role exists it has no
 // DDL, and administrative commands use MIGRATION_DATABASE_URL instead.
 const command=process.argv[2],runtime=required('DATABASE_URL'),url=process.env.MIGRATION_DATABASE_URL||runtime;
 if(command==='status'){describe('status',await snapshot(url));return}
 if(command==='backup'){const before=await snapshot(url);describe('source',before);console.log(`backup written: ${backup(url)}`);return}
 if(command==='migrate'){
  const before=await snapshot(url);describe('before',before);
  const shipped=await migrationDefinitions();
  if(before.state==='migrated'&&before.versions.length>=shipped.length){await verifyMigrated(url,before);console.log('already at the latest version; verification passed');return}
  if(before.state==='unknown')throw new Error('Refusing to migrate a database in an unknown state');
  if(before.state==='migrated')console.log(`pending: ${shipped.slice(before.versions.length).map(migration=>migration.name).join(', ')}`);
  const file=backup(url);console.log(`backup written: ${file}`);
  await rehearse(file,before);
  // Nothing may have changed between the backup and the real run.
  const current=await snapshot(url);
  if(JSON.stringify(current)!==JSON.stringify(before))throw new Error('Database changed after its backup; run again');
  await Database.migrate(url);
  // New objects belong to the administrator until ownership and grants are reapplied.
  if(process.env.MIGRATION_DATABASE_URL)await provisionRoles(url);
  describe('after',await verifyMigrated(url,before));
  console.log('migration applied and verified');
  return;
 }
 if(command==='provision'){
  if((await snapshot(url)).state!=='migrated')throw new Error('Migrate the database before provisioning roles');
  if(parse(runtime).user===DEFAULT_ROLES.app){await provisionRoles(url);console.log('ownership and runtime grants reapplied');return}
  const password=await provisionRoles(url,DEFAULT_ROLES,true);
  const next=runtimeUrl(url,DEFAULT_ROLES.app,password!);
  // Prove the API can start as the new role before the configuration points at it.
  await (await Database.open(':memory:',next)).close();
  const envFile=resolve(root,'.env'),copy=resolve(root,`.data/env-before-runtime-role-${new Date().toISOString().replace(/[:.]/g,'-')}`);
  const text=readFileSync(envFile,'utf8'),line=/^DATABASE_URL=(.*)$/m.exec(text);
  if(!line)throw new Error('.env has no DATABASE_URL line to replace');
  copyFileSync(envFile,copy);
  writeFileSync(`${envFile}.tmp`,text.replace(line[0],`DATABASE_URL=${next}\n# Administrator connection for migrate, backup and provision only.\nMIGRATION_DATABASE_URL=${line[1]}`));
  renameSync(`${envFile}.tmp`,envFile);
  restrict(copy);restrict(envFile);
  console.log(`runtime role ${DEFAULT_ROLES.app} created; .env now uses it (previous file kept at ${copy})`);
  return;
 }
 if(command==='sample'){
  const file=process.argv[3]?userPath(process.argv[3]):resolve(root,'.data/sample-catalog.xlsx');
  await writeSampleCatalog(file);console.log(`sample catalog written: ${file}`);return;
 }
 if(command==='import'){
  const file=process.argv[3],commit=process.argv.slice(4).some(word=>word==='commit'||word==='--commit');
  if(!file||file.startsWith('--'))throw new Error('Usage: cli.ts import <file.xlsx> [commit]');
  const catalog=await readCatalog(userPath(file)),db=await Database.open(':memory:',runtime);
  try{
   const [admin]=await db.transaction(repo=>repo.find('users',{role:'admin',active:true}),{readOnly:true});
   if(!admin)throw new Error('No active administrator account to attribute the import to');
   const result=await new Procurement(db,false).importCatalog({id:admin.id,name:admin.name,role:admin.role},catalog,commit);
   for(const error of result.errors)console.log(`error: ${error}`);
   console.log(`${result.committed?'imported':result.errors.length?'rejected, nothing written':'preview only, nothing written'}: products=${result.created.products} suppliers=${result.created.suppliers} prices=${result.created.prices}`);
   if(result.errors.length)process.exitCode=1;
  }finally{await db.close()}
  return;
 }
 throw new Error('Usage: cli.ts status | backup | migrate | provision | demo | sample [file] | import <file.xlsx> [commit]');
}
main().catch(error=>{console.error(`database command failed: ${error.message}`);process.exit(1)});
