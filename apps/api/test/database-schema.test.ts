import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';

const expectedTables = [
  'users', 'products', 'suppliers', 'prices', 'requests', 'request_lines',
  'rfqs', 'rfq_suppliers', 'quotations', 'ahp_sessions', 'ahp_candidates',
  'approvals', 'orders', 'order_lines', 'receipts', 'receipt_lines',
  'inventory_balances', 'inventory_movements', 'evaluations', 'history',
  'audit', 'outbox', 'agent_runs', 'agent_steps', 'schema_migrations',
].sort();
const appendOnly = ['request_lines', 'rfq_suppliers', 'ahp_candidates', 'receipts', 'receipt_lines',
  'inventory_movements', 'evaluations', 'audit', 'agent_steps', 'schema_migrations'];

let db: PGlite;
before(async () => {
  db = new PGlite();
  const sql = await readFile(new URL('../migrations/001_core.sql', import.meta.url), 'utf8')
    .catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  await db.exec(sql);
});
after(async () => { await db?.close(); });

test('migration creates exactly 25 normalized procurement tables', async () => {
  const { rows } = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'procurement' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  assert.deepEqual(rows.map(row => row.table_name), expectedTables);
});

// Fixtures live only in an in-memory PGlite transaction. A rejected statement is
// rolled back to its savepoint so later assertions still inspect valid data.
async function isolated(run: () => Promise<void>, fixture = true) {
  await db.exec('BEGIN');
  try { if (fixture) await seed(); await run(); }
  finally { await db.exec('ROLLBACK'); }
}
async function rejected(sql: string, code: string, values: unknown[] = []) {
  await db.exec('SAVEPOINT expected_rejection');
  try {
    await assert.rejects(db.query(sql, values), (error: any) => error.code === code,
      `Expected SQLSTATE ${code}: ${sql}`);
  } finally {
    await db.exec('ROLLBACK TO SAVEPOINT expected_rejection; RELEASE SAVEPOINT expected_rejection');
  }
}
const one = async (sql: string, values: unknown[] = []) => (await db.query<any>(sql, values)).rows[0];

// Derived state is never inserted here: opening stock, PO counters, PO status,
// ledger rows and RFQ closure all come from the schema's own triggers.
async function seed() {
  await db.exec(`
    INSERT INTO procurement.users (id,name,email,role,password_hash)
      VALUES ('u-admin','Admin','admin@example.test','admin','test-hash');
    INSERT INTO procurement.products (id,sku,name,unit,min_stock,opening_stock,created_by_user_id)
      VALUES ('pro-paper','PAPER','Paper','box',0,5,'u-admin'),('pro-ink','INK','Ink','box',2,0,NULL);
    INSERT INTO procurement.suppliers (id,name,email,phone,reputation)
      VALUES ('sup-a','A','a@example.test','',90),('sup-b','B','b@example.test','',91),
             ('sup-uninvited','Uninvited','u@example.test','',80);
    INSERT INTO procurement.prices (id,product_id,supplier_id,unit_price,delivery_days,quality_score)
      VALUES ('price-a','pro-paper','sup-a',10000,3,90);
    INSERT INTO procurement.requests (id,reason,status,created_by_user_id,actor_kind)
      VALUES ('req-a','Buy multiple products','approved','u-admin','user');
    INSERT INTO procurement.request_lines (id,request_id,line_no,product_id,quantity)
      VALUES ('req-line-1','req-a',1,'pro-paper',10),('req-line-2','req-a',2,'pro-ink',10),
             ('req-line-3','req-a',3,'pro-paper',10);
    INSERT INTO procurement.rfqs (id,request_line_id,request_id,product_id,status)
      VALUES ('rfq-1','req-line-1','req-a','pro-paper','open'),
             ('rfq-2','req-line-2','req-a','pro-ink','open'),
             ('rfq-3','req-line-3','req-a','pro-paper','open');
    INSERT INTO procurement.rfq_suppliers (rfq_id,supplier_id)
      VALUES ('rfq-1','sup-a'),('rfq-1','sup-b'),('rfq-2','sup-a'),('rfq-3','sup-b');
    INSERT INTO procurement.quotations
      (id,rfq_id,supplier_id,quantity,unit_price,vat,currency,delivery_days,quality_score,valid_until,source)
      VALUES ('q-1','rfq-1','sup-a',10,10000,8.25,'VND',3,90,'2030-01-01','manual'),
             ('q-2','rfq-1','sup-b',10,11000,8.25,'VND',2,92,'2030-01-01','manual'),
             ('q-3','rfq-2','sup-a',10,20000,0,'VND',3,90,'2030-01-01','manual'),
             ('q-4','rfq-3','sup-b',10,11000,8.25,'VND',2,92,'2030-01-01','manual');
    INSERT INTO procurement.ahp_sessions
      (id,rfq_id,status,cr,consistent,input_artifact,result_artifact)
      VALUES ('session-1','rfq-1','approved',0.02,true,'{"criteria":[]}','{"ranking":[]}'),
             ('session-2','rfq-2','approved',0.02,true,'{"criteria":[]}','{"ranking":[]}'),
             ('session-3','rfq-3','approved',0.02,true,'{"criteria":[]}','{"ranking":[]}');
    INSERT INTO procurement.ahp_candidates
      (id,session_id,rfq_id,quotation_id,supplier_id,supplier_name,quantity,unit_price,vat,currency,
       delivery_days,quality_score,valid_until,source,quotation_created_at,criterion_inputs)
      VALUES ('candidate-1','session-1','rfq-1','q-1','sup-a','A',10,10000,8.25,'VND',3,90,'2030-01-01','manual',now(),'{"price":10825}'),
             ('candidate-2','session-1','rfq-1','q-2','sup-b','B',10,11000,8.25,'VND',2,92,'2030-01-01','manual',now(),'{"price":11907.5}'),
             ('candidate-3','session-2','rfq-2','q-3','sup-a','A',10,20000,0,'VND',3,90,'2030-01-01','manual',now(),'{"price":20000}'),
             ('candidate-4','session-3','rfq-3','q-4','sup-b','B',10,11000,8.25,'VND',2,92,'2030-01-01','manual',now(),'{"price":11907.5}');
    INSERT INTO procurement.approvals
      (id,gate,request_id,rfq_id,session_id,status,selected_supplier_id,proposal,decided_by,decided_at)
      VALUES ('gate-1',1,'req-a',NULL,NULL,'approved',NULL,'Buy','u-admin',now()),
             ('gate-2',2,'req-a','rfq-1','session-1','approved','sup-a','Choose A','u-admin',now()),
             ('gate-2b',2,'req-a','rfq-2','session-2','approved','sup-a','Choose A','u-admin',now()),
             ('gate-2c',2,'req-a','rfq-3','session-3','approved','sup-b','Choose B','u-admin',now());
    INSERT INTO procurement.orders (id,supplier_id,status)
      VALUES ('po-1','sup-a','ordered'),('po-2','sup-b','ordered');
    INSERT INTO procurement.order_lines
      (id,order_id,line_no,rfq_id,session_id,candidate_id,approval_id,supplier_id,product_id,quantity,unit_price,vat,delivery_days)
      VALUES ('po-line-1','po-1',1,'rfq-1','session-1','candidate-1','gate-2','sup-a','pro-paper',10,10000,8.25,3),
             ('po-line-2','po-1',2,'rfq-2','session-2','candidate-3','gate-2b','sup-a','pro-ink',10,20000,0,3),
             ('po-line-3','po-2',1,'rfq-3','session-3','candidate-4','gate-2c','sup-b','pro-paper',10,11000,8.25,2);
    INSERT INTO procurement.receipts (id,order_id,idempotency_key,received_at,created_by,request_fingerprint,input_payload)
      VALUES ('receipt-1','po-1','receipt-key-1',now(),'u-admin',repeat('a',64),'{"orderId":"po-1","idempotencyKey":"receipt-key-1"}'),
             ('receipt-2','po-2','receipt-key-2',now(),'u-admin',repeat('b',64),'{"orderId":"po-2","idempotencyKey":"receipt-key-2"}');
    INSERT INTO procurement.receipt_lines (id,receipt_id,order_id,order_line_id,product_id,quantity,accepted_quantity)
      VALUES ('receipt-line-1','receipt-1','po-1','po-line-1','pro-paper',4,3),
             ('receipt-line-2','receipt-1','po-1','po-line-2','pro-ink',6,0),
             ('receipt-line-3','receipt-2','po-2','po-line-3','pro-paper',2,2);
    INSERT INTO procurement.evaluations
      (id,order_id,supplier_id,product_id,reported_quality_score,acceptance_score,quality_score,
       delivery_score,service_score,overall_score,created_by)
      VALUES ('evaluation-1','po-1','sup-a','pro-paper',90,0,0,90,90,54,'u-admin');
    INSERT INTO procurement.history (id,product_id,supplier_id,month,quantity,unit_price,on_time,quality_score,synthetic)
      VALUES ('hist-1','pro-paper','sup-a','2026-10-01',20,10000,true,90,true);
    INSERT INTO procurement.audit (id,actor_kind,actor_user_id,actor_name,actor_role,action,entity_type,entity_id,detail)
      VALUES ('audit-1','user','u-admin','Admin','admin','test','orders','po-1','{}');
    INSERT INTO procurement.outbox (id,message_key,type,rfq_id,supplier_id,recipient,subject,text_body,status)
      VALUES ('mail-1','rfq:rfq-1:sup-a','RFQ','rfq-1','sup-a','a@example.test','RFQ','Buy','pending');
    INSERT INTO procurement.agent_runs (id,product_id,quantity,status,stage,created_by)
      VALUES ('run-1','pro-paper',10,'starting',1,'u-admin');
    INSERT INTO procurement.agent_steps (id,run_id,tool,stage,status,detail)
      VALUES ('step-1','run-1','detect_need',1,'completed','"Recorded only; Agent disabled"');
  `);
}

// A fourth request line with its own RFQ, quotation and approved session for
// supplier B. The caller adds candidate, approval and PO line as its case needs.
async function chain(prefix: string, offered = 10) {
  await db.exec(`
    INSERT INTO procurement.request_lines (id,request_id,line_no,product_id,quantity)
      VALUES ('${prefix}-line','req-a',4,'pro-paper',10);
    INSERT INTO procurement.rfqs (id,request_line_id,request_id,product_id,status)
      VALUES ('${prefix}-rfq','${prefix}-line','req-a','pro-paper','open');
    INSERT INTO procurement.rfq_suppliers (rfq_id,supplier_id) VALUES ('${prefix}-rfq','sup-b');
    INSERT INTO procurement.quotations
      (id,rfq_id,supplier_id,quantity,unit_price,vat,currency,delivery_days,quality_score,valid_until)
      VALUES ('${prefix}-quote','${prefix}-rfq','sup-b',${offered},11000,8.25,'VND',2,92,'2030-01-01');
    INSERT INTO procurement.ahp_sessions (id,rfq_id,status,cr,consistent,input_artifact,result_artifact)
      VALUES ('${prefix}-session','${prefix}-rfq','pending_approval',0.02,true,'{}','{}');
  `);
}
const candidateSql = (prefix: string, offered = 10) => `INSERT INTO procurement.ahp_candidates
  (id,session_id,rfq_id,quotation_id,supplier_id,supplier_name,quantity,unit_price,vat,currency,
   delivery_days,quality_score,valid_until,source,quotation_created_at,criterion_inputs)
  VALUES ('${prefix}-candidate','${prefix}-session','${prefix}-rfq','${prefix}-quote','sup-b','B',${offered},$1,$2,'VND',2,92,
    '2030-01-01','manual',now(),'{}')`;
const approve = (prefix: string) => db.exec(`
  INSERT INTO procurement.approvals (id,gate,request_id,rfq_id,session_id,status,proposal)
    VALUES ('${prefix}-gate',2,'req-a','${prefix}-rfq','${prefix}-session','pending','Choose B');
  UPDATE procurement.approvals SET status='approved',selected_supplier_id='sup-b',decided_by='u-admin',decided_at=now()
    WHERE id='${prefix}-gate';
  UPDATE procurement.ahp_sessions SET status='approved' WHERE id='${prefix}-session';`);
const orderLineSql = (prefix: string, overrides: Record<string, string> = {}) => {
  const row: Record<string, string> = {id:`'${prefix}-po-line'`,order_id:`'po-2'`,line_no:'3',rfq_id:`'${prefix}-rfq'`,
    session_id:`'${prefix}-session'`,candidate_id:`'${prefix}-candidate'`,approval_id:`'${prefix}-gate'`,supplier_id:`'sup-b'`,
    product_id:`'pro-paper'`,quantity:'10',unit_price:'11000',vat:'8.25',delivery_days:'2',...overrides};
  return `INSERT INTO procurement.order_lines (${Object.keys(row).join(',')}) VALUES (${Object.values(row).join(',')})`;
};

for (const table of ['prices','quotations','history','ahp_candidates','order_lines'] as const) {
  test(`${table} rejects fractional VND instead of rounding it`, async () => isolated(async () => {
    if (table === 'ahp_candidates') {
      await chain('precision');
      await rejected(candidateSql('precision'),'23514',['11000.1','8.25']);
    } else if (table === 'order_lines') {
      await chain('precision');await db.query(candidateSql('precision'),['11000','8.25']);await approve('precision');
      await rejected(orderLineSql('precision',{unit_price:'11000.1'}),'23514');
    } else {
      const ids={prices:'price-a',quotations:'q-1',history:'hist-1'};
      await rejected(`UPDATE procurement.${table} SET unit_price=$1 WHERE id=$2`,'23514',['10000.1',ids[table]]);
    }
  }));
}
for (const table of ['quotations','ahp_candidates','order_lines'] as const) {
  test(`${table} rejects VAT beyond two decimals instead of rounding it`, async () => isolated(async () => {
    if (table === 'quotations') {
      await rejected(`UPDATE procurement.quotations SET vat=$1 WHERE id='q-1'`,'23514',['0.001']);
    } else if (table === 'ahp_candidates') {
      await chain('precision');
      await rejected(candidateSql('precision'),'23514',['11000','0.001']);
    } else {
      await chain('precision');await db.query(candidateSql('precision'),['11000','8.25']);await approve('precision');
      await rejected(orderLineSql('precision',{vat:'0.001'}),'23514');
    }
  }));
}

test('schema stores typed business columns and no whole-entity data blobs', async () => {
  const { rows } = await db.query<any>(`SELECT table_name,column_name,data_type,numeric_precision,numeric_scale
    FROM information_schema.columns WHERE table_schema='procurement'`);
  assert.equal(rows.some(row => row.column_name === 'data'), false);
  assert.equal(rows.some(row => row.column_name === 'revision'), false);
  const column = (table: string, name: string) => rows.find(row => row.table_name === table && row.column_name === name);
  assert.equal(column('users','id').data_type,'text');
  assert.equal(column('users','active').data_type,'boolean');
  assert.equal(column('request_lines','quantity').data_type,'bigint');
  // Unconstrained numeric preserves submitted precision until CHECK validation;
  // a numeric typmod would silently round invalid money before the CHECK ran.
  assert.equal(column('quotations','unit_price').data_type,'numeric');
  assert.equal(column('quotations','unit_price').numeric_precision,null);
  assert.equal(column('quotations','unit_price').numeric_scale,null);
  assert.equal(column('quotations','vat').numeric_scale,null);
  assert.equal(column('quotations','valid_until').data_type,'date');
  assert.equal(column('receipts','received_at').data_type,'timestamp with time zone');
  assert.equal(column('suppliers','reputation').numeric_scale,null);
  assert.deepEqual(rows.filter(row => row.table_name === 'ahp_sessions' && row.data_type === 'jsonb')
    .map(row => row.column_name).sort(), ['input_artifact','result_artifact']);
});

test('receipt idempotency payload is retained as a required JSON object', async () => isolated(async () => {
  const original = {orderId:'po-1',quantity:4,acceptedQuantity:3,
    receivedAt:'2026-10-11T12:00:00+07:00',idempotencyKey:'payload-key',notes:''};
  const insert = `INSERT INTO procurement.receipts
    (id,order_id,idempotency_key,received_at,created_by,request_fingerprint,input_payload)
    VALUES ($1,'po-1',$1,$2::timestamptz,'u-admin',repeat('c',64),$3::jsonb)`;
  await db.query(insert,['payload-key',original.receivedAt,JSON.stringify(original)]);
  const receipt = await one(`SELECT input_payload,received_at FROM procurement.receipts WHERE id='payload-key'`);
  assert.deepEqual(receipt.input_payload,original);
  assert.equal(new Date(receipt.received_at).toISOString(),'2026-10-11T05:00:00.000Z');
  await rejected(insert,'23502',['null-payload',original.receivedAt,null]);
  await rejected(insert,'23514',['array-payload',original.receivedAt,'[]']);
}));

test('a PO can buy the requested quantity from a larger offered quantity', async () => isolated(async () => {
  await chain('partial',20);await db.query(candidateSql('partial',20),['11000','8.25']);await approve('partial');
  await db.exec(orderLineSql('partial'));
  assert.equal((await one(`SELECT quantity::text FROM procurement.order_lines WHERE id='partial-po-line'`)).quantity,'10');
}));

test('opening stock becomes one OPENING movement attributed to the product creator or the system', async () => isolated(async () => {
  assert.deepEqual((await db.query<any>(`SELECT product_id,delta::text,actor_kind,created_by_user_id
    FROM procurement.inventory_movements WHERE kind='OPENING'`)).rows,
    [{product_id:'pro-paper',delta:'5',actor_kind:'user',created_by_user_id:'u-admin'}]);
  await db.exec(`INSERT INTO procurement.products (id,sku,name,unit,min_stock,opening_stock)
    VALUES ('seeded','SEEDED','Seeded','box',0,2)`);
  assert.deepEqual(await one(`SELECT actor_kind,created_by_user_id,delta::text
    FROM procurement.inventory_movements WHERE product_id='seeded'`),
    {actor_kind:'system',created_by_user_id:null,delta:'2'});
  assert.equal((await one(`SELECT count(*)::int count FROM procurement.inventory_movements WHERE product_id='pro-ink'`)).count,0);
  for (const stock of ['-1','1000000001'])
    await rejected(`INSERT INTO procurement.products (id,sku,name,unit,min_stock,opening_stock)
      VALUES ('capped','CAPPED','Capped','box',0,$1)`,'23514',[stock]);
  await rejected(`UPDATE procurement.products SET min_stock=1000000001 WHERE id='pro-paper'`,'23514');
}));

test('receipt lines alone drive PO counters, PO status, ledger rows and balances', async () => isolated(async () => {
  assert.deepEqual((await db.query<any>(`SELECT id,received_quantity::text received,accepted_quantity::text accepted
    FROM procurement.order_lines ORDER BY id`)).rows,
    [{id:'po-line-1',received:'4',accepted:'3'},{id:'po-line-2',received:'6',accepted:'0'},{id:'po-line-3',received:'2',accepted:'2'}]);
  assert.deepEqual((await db.query<any>(`SELECT id,status FROM procurement.orders ORDER BY id`)).rows,
    [{id:'po-1',status:'partially_received'},{id:'po-2',status:'partially_received'}]);
  // The zero-accepted ink line keeps its receipt but posts nothing.
  assert.deepEqual((await db.query<any>(`SELECT receipt_line_id,delta::text,actor_kind,created_by_user_id
    FROM procurement.inventory_movements WHERE kind='RECEIPT' ORDER BY receipt_line_id`)).rows,
    [{receipt_line_id:'receipt-line-1',delta:'3',actor_kind:'user',created_by_user_id:'u-admin'},
     {receipt_line_id:'receipt-line-3',delta:'2',actor_kind:'user',created_by_user_id:'u-admin'}]);
  const balances = () => db.query<any>(`SELECT b.product_id,b.quantity::text,
    COALESCE(sum(m.delta),0)::text ledger FROM procurement.inventory_balances b
    LEFT JOIN procurement.inventory_movements m USING(product_id)
    GROUP BY b.product_id,b.quantity ORDER BY b.product_id`);
  assert.deepEqual((await balances()).rows,[{product_id:'pro-ink',quantity:'0',ledger:'0'},
    {product_id:'pro-paper',quantity:'10',ledger:'10'}]);

  await db.exec(`INSERT INTO procurement.receipts
    (id,order_id,idempotency_key,received_at,created_by,request_fingerprint,input_payload)
    VALUES ('receipt-3','po-1','receipt-key-3',now(),'u-admin',repeat('c',64),'{"orderId":"po-1"}')`);
  const line = `INSERT INTO procurement.receipt_lines
    (id,receipt_id,order_id,order_line_id,product_id,quantity,accepted_quantity) VALUES ($1,'receipt-3','po-1',$2,$3,$4,$5)`;
  // 4 already received of 10: seven more is over-delivery and leaves no trace.
  await rejected(line,'23514',['over','po-line-1','pro-paper',7,7]);
  assert.equal((await one(`SELECT received_quantity::text received FROM procurement.order_lines WHERE id='po-line-1'`)).received,'4');
  await db.query(line,['fill-1','po-line-1','pro-paper',6,6]);
  assert.equal((await one(`SELECT status FROM procurement.orders WHERE id='po-1'`)).status,'partially_received');
  await db.query(line,['fill-2','po-line-2','pro-ink',4,1]);
  assert.equal((await one(`SELECT status FROM procurement.orders WHERE id='po-1'`)).status,'received');
  assert.deepEqual((await balances()).rows,[{product_id:'pro-ink',quantity:'1',ledger:'1'},
    {product_id:'pro-paper',quantity:'16',ledger:'16'}]);
  assert.equal((await one(`SELECT count(*)::int count FROM procurement.receipt_lines r
    LEFT JOIN procurement.inventory_movements m ON m.receipt_line_id=r.id
    WHERE (r.accepted_quantity>0) <> (m.id IS NOT NULL)`)).count,0);
}));

test('derived state rejects direct writes from any role', async () => isolated(async () => {
  await rejected(`INSERT INTO procurement.inventory_movements (id,product_id,delta,kind,actor_kind)
    VALUES ('direct-opening','pro-ink',2,'OPENING','system')`,'23514');
  await rejected(`INSERT INTO procurement.inventory_movements
    (id,product_id,delta,kind,receipt_line_id,created_by_user_id,actor_kind)
    VALUES ('direct-receipt','pro-ink',6,'RECEIPT','receipt-line-2','u-admin','user')`,'23514');
  await rejected(`UPDATE procurement.inventory_balances SET quantity=99 WHERE product_id='pro-paper'`,'23514');
  await rejected(`DELETE FROM procurement.inventory_balances WHERE product_id='pro-ink'`,'23514');
  await rejected(`INSERT INTO procurement.inventory_balances (product_id,quantity) VALUES ('pro-ink',1)`,'23514');
  await rejected(`UPDATE procurement.order_lines SET received_quantity=10,accepted_quantity=10 WHERE id='po-line-1'`,'23514');
  // A supplied status is replaced by the one the lines imply, on insert and update.
  await db.exec(`UPDATE procurement.orders SET status='received' WHERE id='po-2';
    INSERT INTO procurement.orders (id,supplier_id,status) VALUES ('po-3','sup-a','received')`);
  assert.deepEqual((await db.query<any>(`SELECT id,status FROM procurement.orders WHERE id IN ('po-2','po-3') ORDER BY id`)).rows,
    [{id:'po-2',status:'partially_received'},{id:'po-3',status:'ordered'}]);
  // Counters supplied with a new PO line are discarded as well.
  await chain('fresh');await db.query(candidateSql('fresh'),['11000','8.25']);await approve('fresh');
  await db.exec(orderLineSql('fresh',{received_quantity:'9',accepted_quantity:'9'}));
  assert.deepEqual(await one(`SELECT received_quantity::text received,accepted_quantity::text accepted
    FROM procurement.order_lines WHERE id='fresh-po-line'`),{received:'0',accepted:'0'});
}));

test('real fixtures preserve legacy IDs and allow several lines per document', async () => isolated(async () => {
  const result = await db.query<any>(`SELECT
    (SELECT count(*)::int FROM procurement.request_lines WHERE request_id='req-a') requests,
    (SELECT count(*)::int FROM procurement.order_lines WHERE order_id='po-1') orders,
    (SELECT count(*)::int FROM procurement.receipt_lines WHERE receipt_id='receipt-1') receipts,
    (SELECT id FROM procurement.users LIMIT 1) admin`);
  assert.deepEqual(result.rows[0],{requests:3,orders:2,receipts:2,admin:'u-admin'});
  await rejected(`INSERT INTO procurement.request_lines (id,request_id,line_no,product_id,quantity)
    VALUES ('bad','missing',1,'pro-paper',1)`,'23503');
}));

test('NOT NULL and CHECK constraints reject invalid quantities, money, VAT, currency and statuses', async () => isolated(async () => {
  const requestLine = `INSERT INTO procurement.request_lines (id,request_id,line_no,product_id,quantity)
    VALUES ('checked','req-a',9,'pro-paper',$1)`;
  await rejected(requestLine,'23502',[null]);
  for (const quantity of ['0','-1','10000001']) await rejected(requestLine,'23514',[quantity]);
  await rejected(requestLine,'22P02',['1.5']);
  await db.exec(`INSERT INTO procurement.receipts
    (id,order_id,idempotency_key,received_at,created_by,request_fingerprint,input_payload)
    VALUES ('checked-receipt','po-2','checked-key',now(),'u-admin',repeat('d',64),'{}')`);
  for (const [sql, code] of [
    ["UPDATE procurement.quotations SET quantity=10000001 WHERE id='q-1'",'23514'],
    ["UPDATE procurement.quotations SET unit_price=0 WHERE id='q-1'",'23514'],
    ["UPDATE procurement.quotations SET unit_price=10000000001 WHERE id='q-1'",'23514'],
    ["UPDATE procurement.quotations SET quantity=10000000,unit_price=10000000000 WHERE id='q-1'",'23514'],
    ["UPDATE procurement.quotations SET vat=-0.01 WHERE id='q-1'",'23514'],
    ["UPDATE procurement.quotations SET vat=100.01 WHERE id='q-1'",'23514'],
    ["UPDATE procurement.quotations SET currency='USD' WHERE id='q-1'",'23514'],
    ["UPDATE procurement.quotations SET delivery_days=366 WHERE id='q-1'",'23514'],
    ["UPDATE procurement.quotations SET quality_score=0 WHERE id='q-1'",'23514'],
    ["INSERT INTO procurement.requests (id,reason,status,created_by_user_id,actor_kind) VALUES ('bad-status','Buy','invalid','u-admin','user')",'23514'],
    ["UPDATE procurement.suppliers SET reputation='NaN' WHERE id='sup-a'",'23514'],
    ["UPDATE procurement.products SET min_stock=9007199254740992 WHERE id='pro-paper'",'23514'],
    ["INSERT INTO procurement.receipt_lines (id,receipt_id,order_id,order_line_id,product_id,quantity,accepted_quantity) VALUES ('too-accepted','checked-receipt','po-2','po-line-3','pro-paper',1,5)",'23514'],
    ["INSERT INTO procurement.receipt_lines (id,receipt_id,order_id,order_line_id,product_id,quantity,accepted_quantity) VALUES ('empty-line','checked-receipt','po-2','po-line-3','pro-paper',0,0)",'23514'],
    ["UPDATE procurement.history SET month='2026-10-02' WHERE id='hist-1'",'23514'],
    ["INSERT INTO procurement.evaluations (id,order_id,supplier_id,product_id,reported_quality_score,acceptance_score,quality_score,delivery_score,service_score,overall_score,created_by) VALUES ('bad-score','po-2','sup-b','pro-paper',90,0,0,90,0,54,'u-admin')",'23514'],
    ["UPDATE procurement.agent_runs SET stage=5 WHERE id='run-1'",'23514'],
    ["UPDATE procurement.agent_runs SET tokens_used=-1 WHERE id='run-1'",'23514'],
    ["UPDATE procurement.agent_runs SET step_count=-1 WHERE id='run-1'",'23514'],
    ["INSERT INTO procurement.products (id,sku,name,unit,min_stock) VALUES ('','EMPTY','Empty','box',0)",'23514'],
    ["INSERT INTO procurement.audit (id,actor_kind,actor_user_id,actor_name,actor_role,action,entity_id) VALUES ('untyped','user','u-admin','Admin','admin','test','po-1')",'23514'],
  ] as const) await rejected(sql,code);
  for (const cr of ['-0.1','NaN','Infinity','-Infinity']) {
    await rejected(`INSERT INTO procurement.ahp_sessions
      (id,rfq_id,status,cr,consistent,input_artifact,result_artifact)
      VALUES ('invalid-cr','rfq-1','draft',$1,true,'{}','{}')`,'23514',[cr]);
  }
  await rejected(`INSERT INTO procurement.ahp_sessions
    (id,rfq_id,status,cr,consistent,input_artifact,result_artifact)
    VALUES ('invalid-json','rfq-1','draft',0,true,'[]','{}')`,'23514');
  // Preserve arbitrary legacy numeric score precision instead of rounding it.
  await db.exec(`UPDATE procurement.suppliers SET reputation=90.123456789 WHERE id='sup-a'`);
  assert.equal((await one(`SELECT reputation::text FROM procurement.suppliers WHERE id='sup-a'`)).reputation,'90.123456789');
}));

test('composite foreign keys reject uninvited quotes and mixed procurement lineage', async () => isolated(async () => {
  // Use an as-yet unordered RFQ: a duplicate RFQ unique violation must not hide
  // the FK violations this test is specifically proving.
  await chain('new');await db.query(candidateSql('new'),['11000','8.25']);
  await rejected(`INSERT INTO procurement.approvals
    (id,gate,request_id,rfq_id,session_id,status,selected_supplier_id,proposal)
    VALUES ('wrong-choice',2,'req-a','new-rfq','new-session','pending','sup-a','Choose')`,'23503');
  await rejected(`INSERT INTO procurement.approvals (id,gate,request_id,rfq_id,session_id,status,proposal)
    VALUES ('wrong-rfq',2,'req-a','rfq-2','new-session','pending','Choose')`,'23503');
  await approve('new');
  await rejected(`INSERT INTO procurement.quotations
    (id,rfq_id,supplier_id,quantity,unit_price,delivery_days,quality_score,valid_until)
    VALUES ('uninvited','rfq-1','sup-uninvited',10,10000,3,90,'2030-01-01')`,'23503');
  await rejected(`INSERT INTO procurement.ahp_candidates
    (id,session_id,rfq_id,quotation_id,supplier_id,supplier_name,quantity,unit_price,vat,currency,
     delivery_days,quality_score,valid_until,source,quotation_created_at,criterion_inputs)
    VALUES ('mixed-candidate','session-2','rfq-2','q-2','sup-b','B',10,11000,8.25,'VND',2,92,
    '2030-01-01','manual',now(),'{}')`,'23503');
  for (const overrides of [
    {order_id:`'po-1'`},                     // PO of another supplier
    {session_id:`'session-1'`},              // candidate of another session
    {product_id:`'pro-ink'`},                // product not requested by this RFQ
    {unit_price:'9999'},                     // terms differ from the candidate
  ]) await rejected(orderLineSql('new',overrides),'23503');
  await rejected(orderLineSql('new',{line_no:'1'}),'23505');
  await db.exec(`INSERT INTO procurement.receipts
    (id,order_id,idempotency_key,received_at,created_by,request_fingerprint,input_payload)
    VALUES ('mixing','po-1','mixing-key',now(),'u-admin',repeat('e',64),'{}')`);
  await rejected(`INSERT INTO procurement.receipt_lines
    (id,receipt_id,order_id,order_line_id,product_id,quantity,accepted_quantity)
    VALUES ('mixed-receipt','mixing','po-1','po-line-3','pro-paper',1,1)`,'23503');
  await rejected(`INSERT INTO procurement.receipt_lines
    (id,receipt_id,order_id,order_line_id,product_id,quantity,accepted_quantity)
    VALUES ('mixed-header','mixing','po-2','po-line-3','pro-paper',1,1)`,'23503');
  await rejected(`INSERT INTO procurement.approvals (id,gate,request_id,status,session_id,proposal)
    VALUES ('wrong-gate',1,'req-a','pending','session-1','Buy')`,'23514');
  await rejected(`INSERT INTO procurement.outbox
    (id,message_key,type,rfq_id,supplier_id,recipient,subject,text_body,status)
    VALUES ('wrong-mail','wrong-mail','RFQ','rfq-1','sup-uninvited','u@example.test','RFQ','Buy','pending')`,'23503');
}));

test('both approval gates are enforced by foreign keys on the approved status', async () => isolated(async () => {
  for (const status of ['pending','rejected']) {
    await db.exec(`INSERT INTO procurement.requests (id,reason,status,created_by_user_id,actor_kind)
        VALUES ('req-${status}','Not approved','${status}','u-admin','user');
      INSERT INTO procurement.request_lines (id,request_id,line_no,product_id,quantity)
        VALUES ('line-${status}','req-${status}',1,'pro-paper',1)`);
    await rejected(`INSERT INTO procurement.rfqs (id,request_line_id,request_id,product_id,status)
      VALUES ('rfq-${status}','line-${status}','req-${status}','pro-paper','open')`,'23503');
  }
  await rejected(`INSERT INTO procurement.rfqs (id,request_line_id,request_id,product_id,request_status,status)
    VALUES ('rfq-lying','line-pending','req-pending','pro-paper','pending','open')`,'23514');

  await chain('gated');await db.query(candidateSql('gated'),['11000','8.25']);
  await db.exec(`INSERT INTO procurement.approvals (id,gate,request_id,rfq_id,session_id,status,proposal)
    VALUES ('gated-gate',2,'req-a','gated-rfq','gated-session','pending','Choose B')`);
  await rejected(orderLineSql('gated'),'23503');                       // still pending
  await rejected(orderLineSql('gated',{approval_id:`'gate-2c'`}),'23503'); // approval of another session
  await rejected(orderLineSql('gated',{approval_status:`'pending'`}),'23514');
  await db.exec(`UPDATE procurement.approvals SET status='rejected',selected_supplier_id='sup-b',
    decided_by='u-admin',decided_at=now() WHERE id='gated-gate'`);
  await rejected(orderLineSql('gated'),'23503');                       // rejected

  // An approved decision that already backs a PO line, and a request that
  // already has an RFQ, are held in place by the same keys.
  await rejected(`UPDATE procurement.approvals SET comment='edited' WHERE id='gate-2'`,'23514');
  await rejected(`UPDATE procurement.requests SET status='rejected' WHERE id='req-a'`,'23514');
  assert.equal((await one(`SELECT status FROM procurement.rfqs WHERE id='rfq-1'`)).status,'closed');
  assert.equal((await one(`SELECT status FROM procurement.rfqs WHERE id='gated-rfq'`)).status,'open');
}));

test('an RFQ holds at most one session that is awaiting or holding an approval', async () => isolated(async () => {
  const session = `INSERT INTO procurement.ahp_sessions (id,rfq_id,status,cr,consistent,input_artifact,result_artifact)
    VALUES ($1,'rfq-1',$2,0.02,true,'{}','{}')`;
  await rejected(session,'23505',['second-approved','approved']);
  await rejected(session,'23505',['second-pending','pending_approval']);
  await db.query(session,['draft','draft']);
  await rejected(`UPDATE procurement.ahp_sessions SET status='pending_approval' WHERE id='draft'`,'23505');
  // Superseding the approved session first frees the slot.
  await db.exec(`UPDATE procurement.ahp_sessions SET status='stale' WHERE id='session-1';
    UPDATE procurement.ahp_sessions SET status='pending_approval' WHERE id='draft'`);
}));

test('status changes follow the lifecycle tables and final rows are frozen', async () => isolated(async () => {
  await db.exec(`INSERT INTO procurement.requests (id,reason,status,created_by_user_id,actor_kind)
    VALUES ('req-open','Pending','pending','u-admin','user');
    INSERT INTO procurement.approvals (id,gate,request_id,status,proposal) VALUES ('open-gate',1,'req-open','pending','Buy');
    INSERT INTO procurement.ahp_sessions (id,rfq_id,status,cr,consistent,input_artifact,result_artifact)
    VALUES ('draft','rfq-1','draft',0.02,true,'{}','{}')`);
  for (const sql of [
    "UPDATE procurement.requests SET status='pending' WHERE id='req-a'",
    "UPDATE procurement.requests SET reason='Changed' WHERE id='req-open'",
    "DELETE FROM procurement.requests WHERE id='req-open'",
    "UPDATE procurement.approvals SET status='pending' WHERE id='gate-1'",
    "UPDATE procurement.approvals SET status='rejected' WHERE id='gate-1'",
    "UPDATE procurement.approvals SET comment='Rewritten' WHERE id='gate-1'",
    "UPDATE procurement.approvals SET proposal='Rewritten' WHERE id='open-gate'",
    "DELETE FROM procurement.approvals WHERE id='open-gate'",
    "UPDATE procurement.ahp_sessions SET status='approved' WHERE id='draft'",
    "UPDATE procurement.ahp_sessions SET status='draft' WHERE id='session-1'",
    "UPDATE procurement.rfqs SET status='open' WHERE id='rfq-1'",
    "UPDATE procurement.rfqs SET run_id='run-1' WHERE id='rfq-2'",
    "DELETE FROM procurement.orders WHERE id='po-1'",
    "UPDATE procurement.orders SET supplier_id='sup-b' WHERE id='po-1'",
  ]) await rejected(sql,'23514');
  await db.exec(`UPDATE procurement.requests SET status='approved' WHERE id='req-open';
    UPDATE procurement.approvals SET status='cancelled' WHERE id='open-gate';
    UPDATE procurement.ahp_sessions SET status='stale' WHERE id='draft';
    UPDATE procurement.orders SET sent_at=now() WHERE id='po-1'`);
  await rejected("UPDATE procurement.approvals SET status='approved',decided_by='u-admin',decided_at=now() WHERE id='open-gate'",'23514');
  await rejected("UPDATE procurement.ahp_sessions SET status='draft' WHERE id='draft'",'23514');
}));

test('business unique keys reject duplicate logical documents', async () => isolated(async () => {
  for (const sql of [
    "INSERT INTO procurement.users (id,name,email,role,password_hash) VALUES ('another','Admin','ADMIN@EXAMPLE.TEST','admin','hash')",
    "INSERT INTO procurement.products (id,sku,name,unit,min_stock) VALUES ('another','PAPER','Paper','box',0)",
    "INSERT INTO procurement.prices (id,product_id,supplier_id,unit_price,delivery_days,quality_score) VALUES ('price-dup','pro-paper','sup-a',100,1,90)",
    "INSERT INTO procurement.request_lines (id,request_id,line_no,product_id,quantity) VALUES ('line-dup','req-a',1,'pro-paper',10)",
    "INSERT INTO procurement.rfqs (id,request_line_id,request_id,product_id,status) VALUES ('rfq-dup','req-line-1','req-a','pro-paper','open')",
    "INSERT INTO procurement.rfq_suppliers (rfq_id,supplier_id) VALUES ('rfq-1','sup-a')",
    "INSERT INTO procurement.quotations (id,rfq_id,supplier_id,quantity,unit_price,delivery_days,quality_score,valid_until) VALUES ('quote-dup','rfq-1','sup-a',10,100,1,90,'2030-01-01')",
    `INSERT INTO procurement.ahp_candidates
      (id,session_id,rfq_id,quotation_id,supplier_id,supplier_name,quantity,unit_price,vat,currency,
       delivery_days,quality_score,valid_until,source,quotation_created_at,criterion_inputs)
      SELECT 'candidate-dup',session_id,rfq_id,quotation_id,supplier_id,supplier_name,quantity,unit_price,vat,currency,
       delivery_days,quality_score,valid_until,source,quotation_created_at,criterion_inputs
      FROM procurement.ahp_candidates WHERE id='candidate-1'`,
    "INSERT INTO procurement.approvals (id,gate,request_id,status,proposal) VALUES ('gate-dup',1,'req-a','pending','Buy')",
    "INSERT INTO procurement.approvals (id,gate,request_id,rfq_id,session_id,status,proposal) VALUES ('gate-dup',2,'req-a','rfq-1','session-1','pending','Choose')",
    "INSERT INTO procurement.order_lines (id,order_id,line_no,rfq_id,session_id,candidate_id,approval_id,supplier_id,product_id,quantity,unit_price,vat,delivery_days) VALUES ('order-dup','po-1',3,'rfq-1','session-1','candidate-1','gate-2','sup-a','pro-paper',10,10000,8.25,3)",
    `INSERT INTO procurement.receipts (id,order_id,idempotency_key,received_at,created_by,request_fingerprint,input_payload)
      VALUES ('receipt-dup','po-1','receipt-key-1',now(),'u-admin',repeat('a',64),'{"orderId":"po-1"}')`,
    "INSERT INTO procurement.receipt_lines (id,receipt_id,order_id,order_line_id,product_id,quantity,accepted_quantity) VALUES ('receipt-line-dup','receipt-1','po-1','po-line-1','pro-paper',1,1)",
    "INSERT INTO procurement.evaluations (id,order_id,supplier_id,product_id,reported_quality_score,acceptance_score,quality_score,delivery_score,service_score,overall_score,created_by) VALUES ('evaluation-dup','po-1','sup-a','pro-paper',90,0,0,90,90,54,'u-admin')",
    "INSERT INTO procurement.outbox (id,message_key,type,rfq_id,supplier_id,recipient,subject,text_body,status) VALUES ('mail-dup','rfq:rfq-1:sup-a','RFQ','rfq-1','sup-a','a@example.test','RFQ','Buy','pending')",
  ]) await rejected(sql,'23505');
  await db.exec(`INSERT INTO procurement.schema_migrations (version,name,checksum) VALUES (1,'001_core.sql',repeat('a',64))`);
  await rejected(`INSERT INTO procurement.schema_migrations (version,name,checksum) VALUES (1,'other.sql',repeat('b',64))`,'23505');
  await rejected(`INSERT INTO procurement.schema_migrations (version,name,checksum) VALUES (2,'002.sql',repeat('a',64))`,'23505');
}));

test('product lifecycle creates zero balances and safely cleans up only unused zero-stock products', async () => isolated(async () => {
  await db.exec(`INSERT INTO procurement.products (id,sku,name,unit,min_stock)
    VALUES ('unused','UNUSED','Unused','box',0)`);
  assert.equal((await one(`SELECT quantity::text FROM procurement.inventory_balances WHERE product_id='unused'`)).quantity,'0');
  await db.exec(`DELETE FROM procurement.products WHERE id='unused'`);
  assert.equal((await one(`SELECT count(*)::int count FROM procurement.inventory_balances WHERE product_id='unused'`)).count,0);
  await rejected(`DELETE FROM procurement.products WHERE id='pro-paper'`,'23514');
  // This product has zero stock but an existing document: FK rollback must also
  // restore the balance removed by the BEFORE DELETE trigger.
  await rejected(`DELETE FROM procurement.products WHERE id='pro-ink'`,'23503');
  assert.equal((await one(`SELECT quantity::text FROM procurement.inventory_balances WHERE product_id='pro-ink'`)).quantity,'0');
}));

test('a product keeps its unit and opening stock, and renaming it does not rewrite an issued PO', async () => isolated(async () => {
  for (const set of ["unit='ream'",'opening_stock=6','created_by_user_id=NULL',"id='renamed'"])
    await rejected(`UPDATE procurement.products SET ${set} WHERE id='pro-paper'`,'23514');
  await db.exec(`UPDATE procurement.products SET sku='PAPER-2',name='Paper A4',min_stock=3 WHERE id='pro-paper'`);
  assert.deepEqual(await one(`SELECT product_sku,product_name,unit FROM procurement.order_lines WHERE id='po-line-1'`),
    {product_sku:'PAPER',product_name:'Paper',unit:'box'});
}));

test('append-only records reject UPDATE, DELETE and TRUNCATE', async () => isolated(async () => {
  await db.exec(`INSERT INTO procurement.schema_migrations (version,name,checksum) VALUES (1,'001_core.sql',repeat('a',64))`);
  for (const table of appendOnly) {
    assert.ok((await one(`SELECT count(*)::int count FROM procurement.${table}`)).count > 0, `${table} fixture`);
    const stamp = table === 'schema_migrations' ? 'applied_at' : 'created_at';
    await rejected(`UPDATE procurement.${table} SET ${stamp}=${stamp}`,'23514');
    await rejected(`DELETE FROM procurement.${table}`,'23514');
    await rejected(`TRUNCATE procurement.${table} CASCADE`,'23514');
  }
  await db.exec(`UPDATE procurement.quotations SET unit_price=12000 WHERE id='q-1'`);
  assert.equal((await one(`SELECT unit_price::text FROM procurement.ahp_candidates WHERE id='candidate-1'`)).unit_price,'10000');
}));

test('AHP math and purchase terms stay immutable', async () => isolated(async () => {
  for (const set of ["input_artifact='{}'","result_artifact='{}'","cr=0.03",'consistent=false',
    "rfq_id='rfq-2'","created_at=now()+interval '1 second'"])
    await rejected(`UPDATE procurement.ahp_sessions SET ${set} WHERE id='session-1'`,'23514');
  await rejected(`DELETE FROM procurement.ahp_sessions WHERE id='session-1'`,'23514');
  await db.exec(`UPDATE procurement.ahp_sessions SET status='stale' WHERE id='session-1'`);
  for (const set of ["rfq_id='rfq-2'","session_id='session-2'","candidate_id='candidate-3'","approval_id='gate-2b'",
    "product_id='pro-ink'","product_name='Edited'","unit='ream'",'quantity=9','unit_price=9999','vat=10','delivery_days=5',
    "order_id='po-2'",'line_no=99',"created_at=now()+interval '1 second'"])
    await rejected(`UPDATE procurement.order_lines SET ${set} WHERE id='po-line-1'`,'23514');
  await rejected(`DELETE FROM procurement.order_lines WHERE id='po-line-1'`,'23514');
}));

test('privileged triggers use a fixed path and their functions have no PUBLIC EXECUTE', async () => {
  const { rows } = await db.query<any>(`SELECT p.proname,p.prosecdef,p.proconfig,
      EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='procurement' ORDER BY p.proname`);
  assert.equal(rows.some(row => row.public_execute),false);
  for (const row of rows) assert.deepEqual(row.proconfig,['search_path=pg_catalog, procurement, pg_temp'],row.proname);
  assert.deepEqual(rows.filter(row => row.prosecdef).map(row => row.proname),
    ['apply_inventory_movement','close_ordered_rfq','create_product_balance','delete_product_balance','post_receipt_line']);
});
