import {PGlite} from '@electric-sql/pglite';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Database,TABLES} from '../src/db';
import {Procurement} from '../src/procurement';
import {legacyV1Fixture,fixtureAdminHash} from './fixtures/legacy-v1';
import {isoTimestamp} from '../src/database/contracts';
import {verifyPassword} from '../src/auth';

async function legacy(pg:PGlite){
 const records=structuredClone(legacyV1Fixture);
 for(const table of TABLES){
  await pg.exec(`CREATE TABLE public.${table}(id text PRIMARY KEY,data jsonb NOT NULL)`);
  for(const data of records[table])await pg.query(`INSERT INTO public.${table}(id,data) VALUES($1,$2::jsonb)`,[data.id,JSON.stringify(data)]);
 }
 await pg.exec("ALTER TABLE public.prices ADD COLUMN products_ref text GENERATED ALWAYS AS (data->>'productId') STORED REFERENCES public.products(id)");
 return records;
}
test('fresh embedded database is versioned and stored exclusively in procurement',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'normalized-fresh-'));const path=join(directory,'pg');
 let db:Database|undefined;
 try{
  db=await Database.open(path);await new Procurement(db).initialize();await db.close();db=undefined;
  const pg=new PGlite(path);try{
   const {rows}=await pg.query<any>('SELECT version,name,checksum FROM procurement.schema_migrations ORDER BY version');const {migrationDefinitions}=await import('../src/database/schema');
   assert.deepEqual(rows.map(row=>[row.version,row.name,row.checksum]),(await migrationDefinitions()).map(m=>[m.version,m.name,m.checksum]));assert.match(rows[0].checksum,/^[0-9a-f]{64}$/);
   assert.equal((await pg.query<any>("SELECT count(*)::int count FROM information_schema.tables WHERE table_schema='public'")).rows[0].count,0);
  }finally{await pg.close()}
  db=await Database.open(path);assert.equal(await db.transaction(async repo=>(await repo.list('products')).length),5);
 }finally{await db?.close();await rm(directory,{recursive:true,force:true})}
});

test('legacy migration preserves all public IDs, hashes, snapshots and Agent cycle, and rebuilds stock from receipts',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'normalized-legacy-'));const path=join(directory,'pg');let pg:PGlite|undefined,db:Database|undefined;
 try{
  pg=new PGlite(path);const before=await legacy(pg);await pg.close();pg=undefined;
  db=await Database.open(path);
  const admin=await db.transaction(r=>r.get('users','u-admin'));
  assert.equal(admin?.passwordHash,fixtureAdminHash);assert.equal(verifyPassword('Fixture@12345',admin!.passwordHash),true);
  await db.transaction(async repo=>{for(const table of TABLES){const after=await repo.list(table);assert.deepEqual(after.map(r=>r.id).sort(),before[table].map((r:any)=>r.id).sort(),table);for(const original of before[table]){
   const actual=after.find(r=>r.id===original.id)!;
   // The old store left an ordered RFQ open; the schema closes it with its PO.
   if(table==='rfqs'){assert.equal(actual.status,'closed');delete (original as any).status}
   if(table==='users'&&original.role==='warehouse'){assert.equal(actual.role,'buyer');delete (original as any).role}
   for(const key of Object.keys(original))if(key!=='items'&&key!=='requestLineId')assert.deepEqual(actual[key],['createdAt','updatedAt','sentAt','decidedAt','receivedAt'].includes(key)?isoTimestamp(original[key]):original[key],`${table}.${key}`);
  }}});
  await db.close();db=undefined;pg=new PGlite(path);
  assert.equal((await pg.query<any>("SELECT count(*)::int count FROM information_schema.tables WHERE table_schema='legacy_json_v1'")).rows[0].count,17);
  // Stock 129 with 9 accepted on the old receipt: 120 opening plus that receipt.
  assert.deepEqual((await pg.query<any>("SELECT kind,delta::text,actor_kind,created_by_user_id FROM procurement.inventory_movements WHERE product_id='product' ORDER BY kind")).rows,
   [{kind:'OPENING',delta:'120',actor_kind:'system',created_by_user_id:null},{kind:'RECEIPT',delta:'9',actor_kind:'user',created_by_user_id:'u-warehouse'}]);
  const {RECONCILIATION}=await import('../src/database/legacy');
  for(const [name,sql] of Object.entries(RECONCILIATION))assert.equal((await pg.query(sql)).rows.length,0,name);
  assert.equal((await pg.query<any>("SELECT count(*)::int count FROM pg_constraint WHERE conrelid='legacy_json_v1.prices'::regclass AND confrelid='legacy_json_v1.products'::regclass")).rows[0].count,1);
  const balances=await pg.query<any>('SELECT b.product_id,b.quantity::text,sum(m.delta)::text ledger FROM procurement.inventory_balances b JOIN procurement.inventory_movements m USING(product_id) GROUP BY b.product_id,b.quantity');
  for(const row of balances.rows)assert.equal(row.quantity,row.ledger);
  await pg.close();pg=undefined;db=await Database.open(path);
  assert.equal((await db.transaction(r=>r.list('receipts'))).length,1);
 }finally{await pg?.close();await db?.close();await rm(directory,{recursive:true,force:true})}
});

test('malformed legacy data rolls back all DDL, data, moves and version logging',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'normalized-rollback-'));const path=join(directory,'pg');let pg:PGlite|undefined;
 try{
  pg=new PGlite(path);await legacy(pg);await pg.query("UPDATE public.history SET data=jsonb_set(data,'{quantity}','-1'::jsonb) WHERE id='hist-0-0'");await pg.close();pg=undefined;
  await assert.rejects(Database.open(path),/history|constraint|quantity/);
  pg=new PGlite(path);
  assert.equal((await pg.query<any>("SELECT count(*)::int count FROM information_schema.tables WHERE table_schema='public'")).rows[0].count,17);
  assert.equal((await pg.query<any>("SELECT count(*)::int count FROM pg_namespace WHERE nspname IN ('procurement','legacy_json_v1')")).rows[0].count,0);
 }finally{await pg?.close();await rm(directory,{recursive:true,force:true})}
});

test('open refuses mismatched checksum, newer versions and partial unknown schemas',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'normalized-version-'));const path=join(directory,'pg');let db:Database|undefined,pg:PGlite|undefined;
 try{
  db=await Database.open(path);await db.close();db=undefined;pg=new PGlite(path);
  // The version log is append-only; only a test tampers with it.
  await pg.exec('ALTER TABLE procurement.schema_migrations DISABLE TRIGGER schema_migrations_immutable');
  await pg.query("UPDATE procurement.schema_migrations SET checksum=repeat('a',64) WHERE version=1");await pg.close();pg=undefined;
  await assert.rejects(Database.open(path),/checksum/);
  pg=new PGlite(path);await pg.query('UPDATE procurement.schema_migrations SET version=version+10');await pg.close();pg=undefined;
  await assert.rejects(Database.open(path),/version/);
 }finally{await db?.close();await pg?.close();await rm(directory,{recursive:true,force:true})}
 const partial=new PGlite();try{
  await partial.exec('CREATE SCHEMA procurement; CREATE TABLE procurement.stray(id text)');
  const {migrateEmbedded}=await import('../src/database/migrate');
  await assert.rejects(migrateEmbedded(partial),/partial|Unknown|schema/);
 }finally{await partial.close()}
});

test('migration checksum ignores BOM and platform line endings while detecting content changes',async()=>{
 const {migrationDefinition}=await import('../src/database/schema');
 const lf=await migrationDefinition('SELECT 1;\n');
 assert.equal((await migrationDefinition('\ufeffSELECT 1;\r\n')).checksum,lf.checksum);
 assert.notEqual((await migrationDefinition('SELECT 2;\n')).checksum,lf.checksum);
});

test('migration rejects an Agent binding that points across document chains',async()=>{
 const pg=new PGlite();try{
  await legacy(pg);
  const other={...legacyV1Fixture.agent_runs[0],id:'run-other',status:'starting',stage:1};
  for(const key of ['requestId','rfqId','sessionId','orderId'])delete (other as any)[key];
  await pg.query('INSERT INTO public.agent_runs(id,data) VALUES($1,$2::jsonb)',[other.id,JSON.stringify(other)]);
  await pg.query("UPDATE public.requests SET data=jsonb_set(data,'{runId}','\"run-other\"'::jsonb)");
  const {migrateEmbedded}=await import('../src/database/migrate');
  await assert.rejects(migrateEmbedded(pg),/Agent|binding|chain/);
  assert.equal((await pg.query<any>("SELECT count(*)::int count FROM pg_namespace WHERE nspname='procurement'")).rows[0].count,0);
 }finally{await pg.close()}
});

test('migration refuses an unrelated schema and rolls back a forced error after table moves',async()=>{
 const unknown=new PGlite();try{
  await unknown.exec('CREATE SCHEMA alien; CREATE TABLE alien.stray(id text)');
  const {migrateEmbedded}=await import('../src/database/migrate');
  await assert.rejects(migrateEmbedded(unknown),/Unknown|schema/);
 }finally{await unknown.close()}
 const pg=new PGlite();try{
  await legacy(pg);
  const {migrateStep}=await import('../src/database/migrate');
  await assert.rejects(pg.transaction(tx=>migrateStep({exec:sql=>tx.exec(sql),query:async(sql,values)=>{
   if(sql.startsWith('INSERT INTO procurement.schema_migrations'))throw new Error('Forced error after legacy moves');
   return tx.query(sql,values);
  }})),/Forced error/);
  assert.equal((await pg.query<any>("SELECT count(*)::int count FROM information_schema.tables WHERE table_schema='public'")).rows[0].count,17);
  assert.equal((await pg.query<any>("SELECT count(*)::int count FROM pg_namespace WHERE nspname IN ('procurement','legacy_json_v1')")).rows[0].count,0);
 }finally{await pg.close()}
});

test('runner applies a later version, backs up first, and verifies every applied version',async()=>{
 const {copyFile,mkdir,readdir,writeFile}=await import('node:fs/promises');
 const {MIGRATIONS_DIRECTORY,migrationDefinitions}=await import('../src/database/schema');
 const directory=await mkdtemp(join(tmpdir(),'normalized-versions-'));const path=join(directory,'pg'),next=join(directory,'migrations');
 let db:Database|undefined,pg:PGlite|undefined;
 try{
  db=await Database.open(path);await db.close();db=undefined;
  // A new empty database has nothing to lose, so no backup is taken for it.
  assert.deepEqual((await readdir(directory)).sort(),['pg']);
  // Everything this build ships, plus one version it does not know yet.
  const shipped=await migrationDefinitions(),extra=`${String(shipped.length+1).padStart(3,'0')}_supplier_note.sql`;
  await mkdir(next);for(const migration of shipped)await copyFile(join(MIGRATIONS_DIRECTORY,migration.name),join(next,migration.name));
  await writeFile(join(next,extra),'ALTER TABLE procurement.suppliers ADD COLUMN note text;\n');
  db=await Database.open(path,undefined,{migrations:next});await db.close();db=undefined;
  assert.equal((await readdir(join(directory,'backups'))).length,1);
  pg=new PGlite(path);
  assert.deepEqual((await pg.query<any>('SELECT version,name FROM procurement.schema_migrations ORDER BY version')).rows,[...shipped.map(m=>({version:m.version,name:m.name})),{version:shipped.length+1,name:extra}]);
  assert.equal((await pg.query<any>("SELECT count(*)::int count FROM information_schema.columns WHERE table_schema='procurement' AND table_name='suppliers' AND column_name='note'")).rows[0].count,1);
  await pg.close();pg=undefined;
  // Reopening at the same version neither migrates nor backs up again.
  db=await Database.open(path,undefined,{migrations:next});await db.close();db=undefined;
  assert.equal((await readdir(join(directory,'backups'))).length,1);
  // A build that does not know the extra version refuses the newer database.
  await assert.rejects(Database.open(path),/version/);
  // An applied file edited afterwards is detected by its checksum.
  await writeFile(join(next,extra),'ALTER TABLE procurement.suppliers ADD COLUMN note varchar;\n');
  await assert.rejects(Database.open(path,undefined,{migrations:next}),/checksum/);
  await writeFile(join(next,`${String(shipped.length+3).padStart(3,'0')}_gap.sql`),'SELECT 1;\n');
  await assert.rejects(migrationDefinitions(next),/without gaps/);
 }finally{await db?.close();await pg?.close();await rm(directory,{recursive:true,force:true})}
});

test('an embedded legacy directory is copied before it is converted',async()=>{
 const {readdir}=await import('node:fs/promises');
 const directory=await mkdtemp(join(tmpdir(),'normalized-backup-'));const path=join(directory,'pg');let pg:PGlite|undefined,db:Database|undefined;
 try{
  pg=new PGlite(path);await legacy(pg);await pg.close();pg=undefined;
  db=await Database.open(path);await db.close();db=undefined;
  const [copy]=await readdir(join(directory,'backups'));
  pg=new PGlite(join(directory,'backups',copy));
  assert.equal((await pg.query<any>("SELECT count(*)::int count FROM information_schema.tables WHERE table_schema='public'")).rows[0].count,17);
  assert.equal((await pg.query<any>("SELECT count(*)::int count FROM pg_namespace WHERE nspname='procurement'")).rows[0].count,0);
 }finally{await pg?.close();await db?.close();await rm(directory,{recursive:true,force:true})}
});
