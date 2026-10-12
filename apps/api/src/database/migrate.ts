import type {PGlite} from '@electric-sql/pglite';
import {Executor,TABLES} from './contracts';
import {Migration,migrationDefinitions,NORMALIZED_TABLES} from './schema';
import {captureLegacy,importLegacy} from './legacy';

export const MIGRATION_LOCK=714290612;
export type Transact=<T>(fn:(executor:Executor)=>Promise<T>)=>Promise<T>;
async function tableNames(executor:Executor,schema:string){return (await executor.query("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name",[schema])).rows.map(r=>r.table_name)}
const equalNames=(actual:string[],expected:readonly string[])=>actual.length===expected.length&&actual.every((value,index)=>value===[...expected].sort()[index]);
// exec respects dollar-quoted PL/pgSQL; splitting at semicolons cannot.
const execute=(executor:Executor,sql:string)=>executor.exec?executor.exec(sql):executor.query(sql);
const record=(executor:Executor,migration:Migration)=>executor.query('INSERT INTO procurement.schema_migrations(version,name,checksum) VALUES($1,$2,$3)',[migration.version,migration.name,migration.checksum]);

/** Every applied version must be one this build knows, in order and unchanged.
 * Returns how many are applied; a database ahead of the code is an error. */
async function appliedCount(executor:Executor,migrations:Migration[]):Promise<number> {
 const applied=(await executor.query('SELECT version,name,checksum FROM procurement.schema_migrations ORDER BY version')).rows;
 if(!applied.length)throw new Error('Unknown or partial procurement schema; run the explicit administrative migration');
 applied.forEach((row,index)=>{
  const known=migrations[index];
  if(!known||row.version!==known.version||row.name!==known.name)throw new Error('Unsupported database migration version');
  if(row.checksum!==known.checksum)throw new Error(`Database migration checksum mismatch: ${known.name}`);
 });
 return applied.length;
}
/** Runtime check: the database is exactly at the last version this build knows. */
export async function verifySchema(executor:Executor,directory?:string){
 const migrations=await migrationDefinitions(directory);
 if(!(await tableNames(executor,'procurement')).includes('schema_migrations'))throw new Error('Unknown or partial procurement schema; run the explicit administrative migration');
 if(await appliedCount(executor,migrations)<migrations.length)throw new Error('Database migration version is behind this build; run the explicit administrative migration');
 if(!directory&&!equalNames(await tableNames(executor,'procurement'),NORMALIZED_TABLES))throw new Error('Unknown or partial procurement schema; run the explicit administrative migration');
}
/** True when opening this database would change it: old JSON tables to convert
 * or versions still to apply. A new empty database has nothing to lose. */
export async function needsMigration(executor:Executor,directory?:string):Promise<boolean> {
 const procurement=await tableNames(executor,'procurement');
 if(!procurement.length)return (await tableNames(executor,'public')).length>0;
 if(!procurement.includes('schema_migrations'))return false;
 const migrations=await migrationDefinitions(directory);
 return (await executor.query('SELECT count(*)::int count FROM procurement.schema_migrations')).rows[0].count<migrations.length;
}
/** One step in the caller's transaction (with the migration advisory lock on
 * native PostgreSQL): the baseline including the one-time legacy JSON import,
 * or the next pending version. Returns true once nothing is pending. Never
 * repairs an unknown or partially installed state. */
export async function migrateStep(executor:Executor,directory?:string):Promise<boolean> {
 const migrations=await migrationDefinitions(directory);
 const unknown=(await executor.query("SELECT nspname FROM pg_namespace WHERE left(nspname,3)<>'pg_' AND nspname NOT IN ('information_schema','public','procurement','legacy_json_v1')")).rows;
 if(unknown.length)throw new Error('Unknown database schema; administrative inspection is required');
 const schemas=(await executor.query("SELECT nspname FROM pg_namespace WHERE nspname IN ('procurement','legacy_json_v1') ORDER BY nspname")).rows.map(r=>r.nspname);
 const publicNames=await tableNames(executor,'public');
 if(schemas.includes('procurement')){
  if(!(await tableNames(executor,'procurement')).includes('schema_migrations'))throw new Error('Unknown or partial procurement schema; run the explicit administrative migration');
  if(publicNames.length)throw new Error('Unknown public tables alongside versioned procurement schema');
  if(schemas.includes('legacy_json_v1')&&!equalNames(await tableNames(executor,'legacy_json_v1'),TABLES))throw new Error('Unknown or partial retained legacy schema');
  const next=migrations[await appliedCount(executor,migrations)];
  if(!next){await verifySchema(executor,directory);return true}
  await execute(executor,next.sql);await record(executor,next);
  return false;
 }
 if(schemas.length)throw new Error('Unknown or partial legacy migration schema');
 if(publicNames.length&&!equalNames(publicNames,TABLES))throw new Error('Unknown or partial public legacy schema');
 if(publicNames.length){
  const columns=(await executor.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND column_name IN ('id','data')")).rows;
  for(const table of TABLES)if(!columns.some(c=>c.table_name===table&&c.column_name==='id'&&c.data_type==='text')||!columns.some(c=>c.table_name===table&&c.column_name==='data'&&c.data_type==='jsonb'))throw new Error(`Unknown legacy table format: ${table}`);
 }
 const records=publicNames.length?await captureLegacy(executor):undefined;
 await execute(executor,migrations[0].sql);
 if(records){
  await importLegacy(executor,records);
  await executor.query('CREATE SCHEMA legacy_json_v1');
  for(const table of TABLES)await executor.query(`ALTER TABLE public.${table} SET SCHEMA legacy_json_v1`);
 }
 await record(executor,migrations[0]);
 return false;
}
/** Each version commits in its own transaction, so a failure in a later one
 * leaves the earlier ones applied and recorded. */
export async function migrateAll(transact:Transact,directory?:string){
 while(!(await transact(executor=>migrateStep(executor,directory))));
}
export const migrateEmbedded=(pg:PGlite,directory?:string)=>migrateAll(fn=>pg.transaction(tx=>fn(tx)),directory);
