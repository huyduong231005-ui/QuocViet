import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

export const MIGRATIONS_DIRECTORY=resolve(__dirname,'../../migrations');
/** Tables present once every migration known to this build has been applied. */
export const NORMALIZED_TABLES=['users','products','suppliers','prices','requests','request_lines','rfqs','rfq_suppliers','quotations','ahp_sessions','ahp_candidates','approvals','orders','order_lines','receipts','receipt_lines','inventory_balances','inventory_movements','evaluations','agent_runs','agent_steps','history','audit','outbox','schema_migrations'].sort();
export interface Migration {version:number;name:string;sql:string;checksum:string}

/** The checksum ignores a BOM and CRLF so a Windows checkout of the same file
 * verifies against a database migrated elsewhere. */
export function migrationDefinition(source:string,name='001_core.sql'):Migration {
 const sql=source.replace(/^﻿/,'').replace(/\r\n/g,'\n');
 return {version:Number(name.slice(0,3)),name,sql,checksum:createHash('sha256').update(sql).digest('hex')};
}
/** Files named NNN_description.sql, numbered 1..n without gaps. A file is frozen
 * once applied to a real database; later changes are new files. */
export async function migrationDefinitions(directory=MIGRATIONS_DIRECTORY):Promise<Migration[]> {
 const names=(await readdir(directory)).filter(name=>/^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
 const migrations=await Promise.all(names.map(async name=>migrationDefinition(await readFile(resolve(directory,name),'utf8'),name)));
 migrations.forEach((migration,index)=>{if(migration.version!==index+1)throw new Error(`Migration files must be numbered without gaps: ${migration.name}`)});
 if(!migrations.length)throw new Error('No migration files found');
 return migrations;
}
