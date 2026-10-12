import {randomBytes} from 'node:crypto';
import {Client} from 'pg';

/** Privileges of the role the API runs as. It can read everything in the
 * business schema and write documents, but owns nothing and has no DDL. Tables
 * absent from a list do not get that privilege: nothing here lets the runtime
 * write the ledger, stock balances, PO lines after insert, or the version log,
 * and nothing lets it TRUNCATE. Triggers still guard columns and status moves,
 * so table-level UPDATE below is what the repository's upserts need, not a way
 * around those rules. */
const INSERT=['users','products','suppliers','prices','requests','request_lines','rfqs','rfq_suppliers','quotations','ahp_sessions','ahp_candidates','approvals','orders','order_lines','receipts','receipt_lines','evaluations','history','audit','outbox','agent_runs','agent_steps'];
const UPDATE=['users','products','suppliers','prices','requests','rfqs','quotations','ahp_sessions','approvals','history','outbox','agent_runs'];
const DELETE=['products','suppliers','prices'];
export interface RoleNames {owner:string;app:string}
export const DEFAULT_ROLES:RoleNames={owner:'quocviet_owner',app:'quocviet_app'};
const identifier=(name:string)=>{if(!/^[a-z_][a-z0-9_]{0,62}$/.test(name))throw new Error(`Invalid role name: ${name}`);return name};
const tables=(names:string[])=>names.map(name=>`procurement.${name}`).join(',');

/** Idempotent. Run as an administrator after every migration: it creates the
 * two roles when missing, hands the schema to the NOLOGIN owner and reapplies
 * the runtime grants. Returns a new runtime password only when one was set. */
export async function provisionRoles(adminUrl:string,names:RoleNames=DEFAULT_ROLES,setPassword=false):Promise<string|undefined> {
 const owner=identifier(names.owner),app=identifier(names.app);
 const client=new Client({connectionString:adminUrl});await client.connect();
 try{
  await client.query('BEGIN');
  const existing=new Set((await client.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1)',[[owner,app]])).rows.map(row=>row.rolname));
  if(!existing.has(owner))await client.query(`CREATE ROLE ${owner} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE`);
  let password:string|undefined;
  if(!existing.has(app)||setPassword){
   password=randomBytes(24).toString('base64url');
   // Role DDL takes no bind parameters; the value is 32 URL-safe characters.
   await client.query(`${existing.has(app)?'ALTER':'CREATE'} ROLE ${app} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`);
  }
  const attributes=(await client.query('SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolcanlogin FROM pg_roles WHERE rolname=ANY($1)',[[owner,app]])).rows;
  for(const role of attributes)if(role.rolsuper||role.rolcreatedb||role.rolcreaterole||(role.rolname===owner&&role.rolcanlogin))throw new Error(`Role ${role.rolname} has privileges this setup must not grant`);

  await client.query(`ALTER SCHEMA procurement OWNER TO ${owner}`);
  for(const {tablename} of (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='procurement'")).rows)await client.query(`ALTER TABLE procurement.${identifier(tablename)} OWNER TO ${owner}`);
  for(const {signature} of (await client.query("SELECT p.oid::regprocedure::text signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='procurement'")).rows){
   await client.query(`ALTER FUNCTION ${signature} OWNER TO ${owner}`);
   await client.query(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,${app}`);
  }
  await client.query(`REVOKE ALL ON SCHEMA procurement FROM PUBLIC,${app}`);
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA procurement FROM PUBLIC,${app}`);
  await client.query(`GRANT USAGE ON SCHEMA procurement TO ${app}`);
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA procurement TO ${app}`);
  await client.query(`GRANT INSERT ON ${tables(INSERT)} TO ${app}`);
  await client.query(`GRANT UPDATE ON ${tables(UPDATE)} TO ${app}`);
  await client.query(`GRANT UPDATE (sent_at,updated_at) ON procurement.orders TO ${app}`);
  await client.query(`GRANT DELETE ON ${tables(DELETE)} TO ${app}`);
  // The retained JSON tables hold old password hashes; only administrators read them.
  if((await client.query("SELECT 1 FROM pg_namespace WHERE nspname='legacy_json_v1'")).rows.length){
   await client.query(`REVOKE ALL ON SCHEMA legacy_json_v1 FROM PUBLIC,${app}`);
   await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA legacy_json_v1 FROM PUBLIC,${app}`);
  }
  await client.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
  await client.query('COMMIT');
  return password;
 }catch(error){try{await client.query('ROLLBACK')}catch{/* Preserve the original error. */}throw error}
 finally{await client.end()}
}
/** Connection string for the runtime role on the same server and database. */
export function runtimeUrl(adminUrl:string,app:string,password:string):string {
 // Both values are plain identifier/base64url characters, so the URL setters need no escaping help.
 const url=new URL(adminUrl);url.username=app;url.password=password;
 return url.toString();
}
