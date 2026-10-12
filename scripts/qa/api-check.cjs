// QA pass over the HTTP API of a fresh real-mode instance: the demo story from an
// empty database, plus the mistakes a presenter or an audience member could make.
// It needs the empty database made by setup.ts and the instance run by serve.cjs:
//   node scripts/qa/api-check.cjs [http://127.0.0.1:3100]
// It prints each failed check and a final count; it expects to start from empty.
const base = (process.argv[2] || 'http://127.0.0.1:3100') + '/api';
const results = [];
const check = (name, ok, detail = '') => { results.push({name, ok: !!ok, detail}); if (!ok) console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); };
const call = async (path, method = 'GET', body, token, raw) => {
  const response = await fetch(base + path, {method, headers: {...(body !== undefined || raw ? {'Content-Type': 'application/json'} : {}), ...(token ? {Authorization: 'Bearer ' + token} : {})}, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined)});
  const type = response.headers.get('content-type') || '';
  const data = type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  return {status: response.status, data};
};
const leaky = message => /constraint|procurement\.|SELECT |INSERT |violates|at async|\.ts:|undefined|\[object/i.test(String(message));
const expectError = (name, r, status) => check(name, r.status === status && typeof r.data.message === 'string' && r.data.message.length > 3 && !leaky(r.data.message), `${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
const matrix = [[1, 2, 4, 4], [.5, 1, 2, 2], [.25, .5, 1, 1], [.25, .5, 1, 1]];
const inconsistent = [[1, 9, 1 / 9, 1], [1 / 9, 1, 9, 1], [9, 1 / 9, 1, 1], [1, 1, 1, 1]];
const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 1500)); }
  const health = await call('/health');
  check('health reports real mode', health.status === 200 && health.data.demoMode === false && health.data.agentEnabled === false, JSON.stringify(health.data));
  expectError('wrong admin password is refused', await call('/auth/login', 'POST', {email: 'admin@qa.local', password: 'sai'}), 401);
  expectError('demo account does not exist in real mode', await call('/auth/login', 'POST', {email: 'buyer@ahp.local', password: 'Demo@12345'}), 401);
  expectError('missing token is refused', await call('/bootstrap'), 401);
  expectError('garbage token is refused', await call('/bootstrap', 'GET', undefined, 'abc.def.ghi'), 401);
  const admin = (await call('/auth/login', 'POST', {email: 'ADMIN@qa.local', password: 'QaAdmin2026'})).data.token;
  check('admin logs in (email case-insensitive)', !!admin);

  // --- empty state
  let b = (await call('/bootstrap', 'GET', undefined, admin)).data;
  check('empty workspace loads', b.products.length === 0 && b.orders.length === 0 && b.dashboard.inventoryValue === 0 && Array.isArray(b.dashboard.warnings), JSON.stringify(b.dashboard).slice(0, 200));
  for (const kind of ['requests', 'rfqs', 'quotations', 'approvals', 'orders', 'receipts', 'evaluations']) { const r = await call(`/list/${kind}`, 'GET', undefined, admin); check(`empty list ${kind}`, r.status === 200 && r.data.total === 0 && r.data.rows.length === 0, JSON.stringify(r.data).slice(0, 120)); }
  for (const type of ['excel', 'pdf']) { const r = await call(`/reports/${type}`, 'GET', undefined, admin); check(`empty ${type} report downloads`, r.status === 200 && r.data.length > 1000, String(r.status)); }
  check('empty audit and ledger', (await call('/audit', 'GET', undefined, admin)).data.total === 0 && (await call('/inventory/movements', 'GET', undefined, admin)).data.total === 0);

  // --- accounts
  const tokens = {admin};
  for (const [role, name] of [['buyer', 'Nhân viên mua hàng & kho'], ['manager', 'Quản lý'], ['auditor', 'Kiểm toán']]) {
    const created = await call('/accounts', 'POST', {name, email: `${role}@qa.local`, role, password: 'MatKhau2026'}, admin);
    check(`create ${role} account`, created.status === 201 && created.data.passwordHash === undefined, JSON.stringify(created.data).slice(0, 120));
    tokens[role] = (await call('/auth/login', 'POST', {email: `${role}@qa.local`, password: 'MatKhau2026'})).data.token;
    check(`${role} logs in`, !!tokens[role]);
  }
  expectError('duplicate account email', await call('/accounts', 'POST', {name: 'Trùng', email: 'BUYER@qa.local', role: 'buyer', password: 'MatKhau2026'}, admin), 409);
  expectError('weak password', await call('/accounts', 'POST', {name: 'Yếu', email: 'yeu@qa.local', role: 'buyer', password: '12345'}, admin), 400);
  expectError('non-admin cannot list accounts', await call('/accounts', 'GET', undefined, tokens.manager), 403);
  const {buyer, manager, auditor} = tokens;

  // --- catalog
  const template = await call('/catalog/template', 'GET', undefined, buyer);
  const fileBase64 = template.data.toString('base64');
  expectError('auditor cannot import', await call('/catalog/import', 'POST', {fileBase64, commit: true}, auditor), 403);
  const preview = await call('/catalog/import', 'POST', {fileBase64}, buyer);
  check('import preview writes nothing', preview.data.committed === false && preview.data.created.products === 5 && (await call('/bootstrap', 'GET', undefined, buyer)).data.products.length === 0, JSON.stringify(preview.data));
  check('import commit', (await call('/catalog/import', 'POST', {fileBase64, commit: true}, buyer)).data.committed === true);
  b = (await call('/bootstrap', 'GET', undefined, buyer)).data;
  check('catalog loaded', b.products.length === 5 && b.suppliers.length === 3 && b.prices.length === 15);
  const again = await call('/catalog/import', 'POST', {fileBase64, commit: true}, buyer);
  check('re-import is rejected row by row', again.data.committed === false && again.data.errors.length === 23, String(again.data.errors?.length));
  const product = id => b.products.find(p => p.sku === id), [s1, s2, s3] = b.suppliers;
  const extra = await call('/products', 'POST', {sku: 'QA-1', name: 'Hàng thử', unit: 'cái', minStock: 5, stock: 7}, buyer);
  check('create product with opening stock', extra.status === 201 && extra.data.stock === 7, JSON.stringify(extra.data).slice(0, 100));
  expectError('duplicate SKU', await call('/products', 'POST', {sku: 'QA-1', name: 'Trùng', unit: 'cái', minStock: 0, stock: 0}, buyer), 409);
  expectError('unit cannot change', await call(`/products/${extra.data.id}`, 'PATCH', {unit: 'hộp'}, buyer), 400);
  expectError('stock cannot be edited', await call(`/products/${extra.data.id}`, 'PATCH', {stock: 99}, buyer), 400);
  check('rename product', (await call(`/products/${extra.data.id}`, 'PATCH', {name: 'Hàng thử 2'}, buyer)).data.name === 'Hàng thử 2');
  expectError('product with stock history cannot be deleted', await call(`/products/${extra.data.id}`, 'DELETE', undefined, buyer), 409);
  const unused = await call('/products', 'POST', {sku: 'QA-2', name: 'Chưa dùng', unit: 'cái', minStock: 0, stock: 0}, buyer);
  check('unused zero-stock product can be deleted', (await call(`/products/${unused.data.id}`, 'DELETE', undefined, buyer)).status === 200);
  expectError('negative price', await call('/prices', 'POST', {productId: product('VP-A4-80').id, supplierId: s1.id, unitPrice: -1, deliveryDays: 1, qualityScore: 90}, buyer), 400);
  expectError('auditor cannot write catalog', await call('/suppliers', 'POST', {name: 'X', email: 'x@example.test'}, auditor), 403);

  // --- request and gate 1
  expectError('auditor cannot request', await call('/requests', 'POST', {productId: product('VP-A4-80').id, quantity: 1, reason: 'x'}, auditor), 403);
  expectError('quantity must be a number', await call('/requests', 'POST', {productId: product('VP-A4-80').id, quantity: '10', reason: 'x'}, buyer), 400);
  expectError('unknown product', await call('/requests', 'POST', {productId: 'khong-co', quantity: 1, reason: 'x'}, buyer), 404);
  const rejected = (await call('/requests', 'POST', {productId: product('VP-TP-48').id, quantity: 5, reason: 'Sẽ bị từ chối'}, buyer)).data;
  expectError('buyer cannot approve', await call(`/requests/${rejected.id}/approve`, 'POST', {approved: true}, buyer), 403);
  check('manager rejects', (await call(`/requests/${rejected.id}/approve`, 'POST', {approved: false, comment: 'Chưa cần'}, manager)).data.status === 'rejected');
  expectError('RFQ for a rejected request', await call('/rfqs', 'POST', {requestId: rejected.id, supplierIds: [s1.id, s2.id]}, buyer), 400);
  expectError('deciding twice the other way', await call(`/requests/${rejected.id}/approve`, 'POST', {approved: true}, manager), 409);
  const request = (await call('/requests', 'POST', {productId: product('VP-A4-80').id, quantity: 100, reason: 'Giấy cho quý 4'}, buyer)).data;
  expectError('RFQ before approval', await call('/rfqs', 'POST', {requestId: request.id, supplierIds: [s1.id, s2.id]}, buyer), 400);
  await call(`/requests/${request.id}/approve`, 'POST', {approved: true, comment: 'Đồng ý'}, manager);

  // --- RFQ and quotations
  expectError('RFQ needs two suppliers', await call('/rfqs', 'POST', {requestId: request.id, supplierIds: [s1.id]}, buyer), 400);
  expectError('RFQ with a repeated supplier', await call('/rfqs', 'POST', {requestId: request.id, supplierIds: [s1.id, s1.id]}, buyer), 400);
  const rfq = (await call('/rfqs', 'POST', {requestId: request.id, supplierIds: [s1.id, s2.id]}, buyer)).data;
  check('RFQ created', rfq.status === 'open' && rfq.quantity === 100, JSON.stringify(rfq).slice(0, 120));
  check('RFQ is idempotent per request line', (await call('/rfqs', 'POST', {requestId: request.id, supplierIds: [s1.id, s2.id]}, buyer)).data.id === rfq.id);
  const quote = (supplierId, extra = {}) => ({rfqId: rfq.id, supplierId, quantity: 100, unitPrice: 70000, deliveryDays: 3, qualityScore: 90, vat: 8, currency: 'VND', validUntil: day(30), ...extra});
  expectError('quotation from an uninvited supplier', await call('/quotations', 'POST', quote(s3.id), buyer), 400);
  expectError('quotation below requested quantity', await call('/quotations', 'POST', quote(s1.id, {quantity: 50}), buyer), 400);
  expectError('fractional VND', await call('/quotations', 'POST', quote(s1.id, {unitPrice: 70000.5}), buyer), 400);
  expectError('invalid date', await call('/quotations', 'POST', quote(s1.id, {validUntil: '2026-02-31'}), buyer), 400);
  expectError('supplier in an RFQ cannot be deleted', await call(`/suppliers/${s1.id}`, 'DELETE', undefined, buyer), 409);
  const q1 = (await call('/quotations', 'POST', quote(s1.id), buyer)).data;
  expectError('AHP with one quotation', await call('/ahp/compute', 'POST', {rfqId: rfq.id, matrix}, buyer), 400);
  const expired = (await call('/quotations', 'POST', quote(s2.id, {validUntil: day(-2), unitPrice: 60000}), buyer)).data;
  expectError('AHP ignores an expired quotation', await call('/ahp/compute', 'POST', {rfqId: rfq.id, matrix}, buyer), 400);
  expectError('second quotation for the same supplier', await call('/quotations', 'POST', quote(s2.id, {unitPrice: 61000}), buyer), 409);
  check('edit quotation', (await call(`/quotations/${expired.id}`, 'PATCH', {validUntil: day(30), unitPrice: 72000, deliveryDays: 2}, buyer)).data.unitPrice === 72000);

  // --- AHP and gate 2
  expectError('non-reciprocal matrix', await call('/ahp/compute', 'POST', {rfqId: rfq.id, matrix: [[1, 2, 3, 4], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]]}, buyer), 400);
  const bad = await call('/ahp/compute', 'POST', {rfqId: rfq.id, matrix: inconsistent, iterations: 200}, buyer);
  check('inconsistent matrix is computed but flagged', bad.status === 201 && bad.data.consistent === false && bad.data.cr > 0.1, JSON.stringify(bad.data).slice(0, 100));
  expectError('inconsistent session cannot be submitted', await call(`/ahp/sessions/${bad.data.id}/request-approval`, 'POST', {}, buyer), 400);
  const session = (await call('/ahp/compute', 'POST', {rfqId: rfq.id, matrix, iterations: 500}, buyer)).data;
  const shares = session.ranking.reduce((sum, r) => sum + r.score, 0), mc = session.monteCarlo.winProbabilities.reduce((sum, p) => sum + p.probability, 0);
  check('AHP ranking and Monte Carlo sum to one', Math.abs(shares - 1) < 1e-9 && Math.abs(mc - 1) < 1e-9 && session.consistent, `${shares} ${mc}`);
  expectError('PO before gate 2', await call('/orders', 'POST', {sessionId: session.id}, buyer), 403);
  const gate = (await call(`/ahp/sessions/${session.id}/request-approval`, 'POST', {}, buyer)).data;
  expectError('buyer cannot decide gate 2', await call(`/approvals/${gate.id}/decide`, 'POST', {approved: true}, buyer), 403);
  const other = session.ranking[1].supplierId;
  expectError('choosing another supplier needs a reason', await call(`/approvals/${gate.id}/decide`, 'POST', {approved: true, supplierId: other}, manager), 400);
  expectError('choosing a supplier outside the session', await call(`/approvals/${gate.id}/decide`, 'POST', {approved: true, supplierId: s3.id, comment: 'x'}, manager), 400);
  // Editing a quotation voids the pending proposal.
  await call(`/quotations/${q1.id}`, 'PATCH', {unitPrice: 69000}, buyer);
  expectError('decision on a voided proposal', await call(`/approvals/${gate.id}/decide`, 'POST', {approved: true}, manager), 409);
  const session2 = (await call('/ahp/compute', 'POST', {rfqId: rfq.id, matrix, iterations: 500}, buyer)).data;
  const gate2 = (await call(`/ahp/sessions/${session2.id}/request-approval`, 'POST', {}, buyer)).data;
  const decided = await call(`/approvals/${gate2.id}/decide`, 'POST', {approved: true, supplierId: session2.ranking[1].supplierId, comment: 'Giao nhanh hơn'}, manager);
  check('gate 2 approves the second-ranked supplier with a reason', decided.status === 201 && decided.data.supplierId === session2.ranking[1].supplierId, JSON.stringify(decided.data).slice(0, 120));
  check('repeating the same decision is harmless', (await call(`/approvals/${gate2.id}/decide`, 'POST', {approved: true, supplierId: session2.ranking[1].supplierId, comment: 'Giao nhanh hơn'}, manager)).status === 201);

  // --- PO, receipts, evaluation
  const po = (await call('/orders', 'POST', {sessionId: session2.id}, buyer)).data;
  check('PO uses the approved supplier and snapshot price', po.supplierId === session2.ranking[1].supplierId && po.status === 'ordered' && po.items.length === 1 && po.total === Math.round(100 * po.items[0].unitPrice * (1 + po.items[0].vat / 100)), JSON.stringify({s: po.supplierId, t: po.total}));
  check('creating the PO again returns the same PO', (await call('/orders', 'POST', {sessionId: session2.id}, buyer)).data.id === po.id);
  expectError('quotation is frozen after the PO', await call(`/quotations/${q1.id}`, 'PATCH', {unitPrice: 1}, buyer), 409);
  expectError('AHP is closed after the PO', await call('/ahp/compute', 'POST', {rfqId: rfq.id, matrix}, buyer), 409);
  check('send PO queues one message', (await call(`/orders/${po.id}/send`, 'POST', {}, buyer)).status === 201 && (await call(`/orders/${po.id}/send`, 'POST', {}, buyer)).status === 201);
  const now = () => new Date().toISOString(), line = po.items[0].id;
  const receipt = (key, quantity, accepted, extra = {}) => ({orderId: po.id, receivedAt: now(), idempotencyKey: key, notes: '', items: [{orderLineId: line, quantity, acceptedQuantity: accepted}], ...extra});
  expectError('manager cannot receive', await call('/receipts', 'POST', receipt('qa-0', 1, 1), manager), 403);
  expectError('receiving more than ordered', await call('/receipts', 'POST', receipt('qa-0', 101, 101), buyer), 400);
  expectError('accepted above delivered', await call('/receipts', 'POST', receipt('qa-0', 10, 11), buyer), 400);
  expectError('receipt dated in the future', await call('/receipts', 'POST', receipt('qa-0', 10, 10, {receivedAt: new Date(Date.now() + 3600000).toISOString()}), buyer), 400);
  expectError('receipt for a line of another PO', await call('/receipts', 'POST', {...receipt('qa-0', 1, 1), items: [{orderLineId: 'khong-co', quantity: 1, acceptedQuantity: 1}]}, buyer), 400);
  const first = receipt('qa-1', 40, 38, {notes: 'Đợt 1'});
  const saved = await call('/receipts', 'POST', first, buyer);
  check('partial receipt', saved.status === 201, JSON.stringify(saved.data).slice(0, 120));
  check('retry with the same key returns the same receipt', (await call('/receipts', 'POST', first, buyer)).data.id === saved.data.id);
  expectError('same key, different content', await call('/receipts', 'POST', {...first, items: [{orderLineId: line, quantity: 41, acceptedQuantity: 38}]}, buyer), 409);
  expectError('evaluation before the PO is complete', await call('/evaluations', 'POST', {orderId: po.id, qualityScore: 90, serviceScore: 90}, buyer), 400);
  expectError('over-delivery on the second batch', await call('/receipts', 'POST', receipt('qa-2', 61, 61), buyer), 400);
  await call('/receipts', 'POST', receipt('qa-2', 60, 60, {notes: 'Đợt 2'}), buyer);
  expectError('receiving after the PO is complete', await call('/receipts', 'POST', receipt('qa-3', 1, 1), buyer), 400);
  expectError('auditor cannot evaluate', await call('/evaluations', 'POST', {orderId: po.id, qualityScore: 90, serviceScore: 90}, auditor), 403);
  expectError('score out of range', await call('/evaluations', 'POST', {orderId: po.id, qualityScore: 101, serviceScore: 90}, buyer), 400);
  const evaluation = await call('/evaluations', 'POST', {orderId: po.id, qualityScore: 90, serviceScore: 90, notes: 'Tốt'}, buyer);
  check('evaluation scores', evaluation.status === 201 && Math.abs(evaluation.data.acceptanceScore - 98) < 1e-9 && evaluation.data.deliveryScore === 100, JSON.stringify(evaluation.data).slice(0, 160));
  expectError('second evaluation', await call('/evaluations', 'POST', {orderId: po.id, qualityScore: 90, serviceScore: 90}, buyer), 409);

  // --- several products on one request and PO
  const multi = (await call('/requests', 'POST', {reason: 'Mực và bút', items: [{productId: product('VP-TN-12A').id, quantity: 10}, {productId: product('VP-BP-01').id, quantity: 24}]}, buyer)).data;
  expectError('repeated product in one request', await call('/requests', 'POST', {reason: 'x', items: [{productId: product('VP-BP-01').id, quantity: 1}, {productId: product('VP-BP-01').id, quantity: 2}]}, buyer), 400);
  await call(`/requests/${multi.id}/approve`, 'POST', {approved: true}, manager);
  expectError('multi-line request needs a line for its RFQ', await call('/rfqs', 'POST', {requestId: multi.id, supplierIds: [s1.id, s2.id]}, buyer), 400);
  const sessions = [];
  for (const item of multi.items) {
    const r = (await call('/rfqs', 'POST', {requestLineId: item.id, supplierIds: [s1.id, s2.id]}, buyer)).data;
    for (const [i, s] of [s1, s2].entries()) await call('/quotations', 'POST', {rfqId: r.id, supplierId: s.id, quantity: item.quantity, unitPrice: 50000 + i * 1000, deliveryDays: 3 - i, qualityScore: 90, vat: 10, currency: 'VND', validUntil: day(30)}, buyer);
    const se = (await call('/ahp/compute', 'POST', {rfqId: r.id, matrix, iterations: 200}, buyer)).data;
    const g = (await call(`/ahp/sessions/${se.id}/request-approval`, 'POST', {}, buyer)).data;
    await call(`/approvals/${g.id}/decide`, 'POST', {approved: true, supplierId: s1.id, comment: 'Gộp một NCC'}, manager);
    sessions.push(se.id);
  }
  const grouped = await call('/orders', 'POST', {sessionIds: sessions}, buyer);
  check('grouped PO has two lines and an exact total', grouped.status === 201 && grouped.data.items.length === 2 && grouped.data.total === grouped.data.items.reduce((sum, l) => sum + l.total, 0), JSON.stringify(grouped.data).slice(0, 120));
  expectError('flat receipt on a multi-line PO', await call('/receipts', 'POST', {orderId: grouped.data.id, quantity: 1, acceptedQuantity: 1, receivedAt: now(), idempotencyKey: 'qa-m0'}, buyer), 400);
  const [l1, l2] = grouped.data.items;
  await call('/receipts', 'POST', {orderId: grouped.data.id, receivedAt: now(), idempotencyKey: 'qa-m1', notes: '', items: [{orderLineId: l1.id, quantity: 10, acceptedQuantity: 9}]}, buyer);
  await call('/receipts', 'POST', {orderId: grouped.data.id, receivedAt: now(), idempotencyKey: 'qa-m2', notes: '', items: [{orderLineId: l2.id, quantity: 24, acceptedQuantity: 24}]}, buyer);

  // --- reads: lists, workspace, ledger, dashboard, reports
  b = (await call('/bootstrap', 'GET', undefined, auditor)).data;
  const totals = {};
  for (const kind of ['requests', 'rfqs', 'quotations', 'approvals', 'orders', 'receipts', 'evaluations']) totals[kind] = (await call(`/list/${kind}`, 'GET', undefined, auditor)).data.total;
  check('list totals', JSON.stringify(totals) === JSON.stringify({requests: 3, rfqs: 3, quotations: 6, approvals: 7, orders: 2, receipts: 4, evaluations: 1}), JSON.stringify(totals));
  check('workspace holds the recent documents', b.orders.length === 2 && b.requests.length === 3 && !('audit' in b), `${b.orders.length} ${b.requests.length}`);
  const paged = []; for (let page = 1; page <= 4; page++) paged.push(...(await call(`/list/receipts?pageSize=1&page=${page}`, 'GET', undefined, auditor)).data.rows.map(r => r.id));
  check('paging walks every row once', new Set(paged).size === 4);
  check('search finds a PO by its short number', (await call(`/list/orders?search=${po.id.slice(0, 8).toUpperCase()}`, 'GET', undefined, auditor)).data.total === 1);
  check('search by product name', (await call(`/list/orders?search=${encodeURIComponent('bút bi')}`, 'GET', undefined, auditor)).data.total === 1);
  expectError('page size above the limit', await call('/list/orders?pageSize=1000', 'GET', undefined, auditor), 400);
  expectError('unknown list', await call('/list/users', 'GET', undefined, auditor), 404);
  const ledger = (await call('/inventory/movements?pageSize=100', 'GET', undefined, auditor)).data.rows, latest = new Map();
  for (const row of ledger) if (!latest.has(row.productId)) latest.set(row.productId, row.balanceAfter);
  check('ledger balance equals product stock for every product', b.products.every(p => (latest.get(p.id) ?? 0) === p.stock), JSON.stringify(b.products.map(p => [p.sku, p.stock, latest.get(p.id)])));
  check('paper stock after receipts', product('VP-A4-80') && b.products.find(p => p.sku === 'VP-A4-80').stock === 120 + 98);
  const spend = b.dashboard.monthlySpend.at(-1);
  check('dashboard spend equals PO totals', spend && spend.orderValue === po.total + grouped.data.total && spend.value === spend.orderValue + spend.historyValue, JSON.stringify(spend));
  check('dashboard counts', b.dashboard.totalProducts === 6 && b.dashboard.pendingApprovals === 0 && b.dashboard.activeOrders === 0, JSON.stringify({p: b.dashboard.totalProducts, a: b.dashboard.pendingApprovals, o: b.dashboard.activeOrders}));
  const audit = await call('/audit?pageSize=100', 'GET', undefined, auditor);
  check('audit rows all name their entity type and no secret', audit.data.rows.every(r => !r.entityId || r.entityType) && !/MatKhau|passwordHash/.test(JSON.stringify(audit.data)), '');
  for (const type of ['excel', 'pdf']) { const r = await call(`/reports/${type}`, 'GET', undefined, auditor); check(`${type} report with data`, r.status === 200 && r.data.length > 3000, String(r.data.length)); }
  expectError('auditor cannot write', await call('/requests', 'POST', {productId: product('VP-A4-80').id, quantity: 1, reason: 'x'}, auditor), 403);

  // --- account lifecycle and transport
  const accounts = (await call('/accounts', 'GET', undefined, admin)).data, buyerAccount = accounts.find(a => a.role === 'buyer');
  await call(`/accounts/${buyerAccount.id}`, 'PATCH', {active: false}, admin);
  expectError('locked account loses its session', await call('/bootstrap', 'GET', undefined, buyer), 401);
  expectError('locked account cannot log in', await call('/auth/login', 'POST', {email: 'buyer@qa.local', password: 'MatKhau2026'}), 401);
  await call(`/accounts/${buyerAccount.id}`, 'PATCH', {active: true}, admin);
  check('unlocked account logs in again', (await call('/auth/login', 'POST', {email: 'buyer@qa.local', password: 'MatKhau2026'})).status === 201);
  expectError('admin cannot lock themselves', await call(`/accounts/${accounts.find(a => a.role === 'admin').id}`, 'PATCH', {active: false}, admin), 400);
  const malformed = await call('/requests', 'POST', undefined, manager, '{"productId":');
  check('malformed JSON is a clean 400', malformed.status === 400 && !leaky(malformed.data.message), JSON.stringify(malformed.data).slice(0, 160));
  const missing = await call('/khong-co', 'GET', undefined, admin);
  check('unknown route is a clean 404', missing.status === 404 && !leaky(missing.data.message), JSON.stringify(missing.data).slice(0, 160));
  const emptyBody = await call('/requests', 'POST', {}, manager);
  check('empty body is a clean 400', emptyBody.status === 400 && !leaky(emptyBody.data.message), JSON.stringify(emptyBody.data).slice(0, 200));

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
})().catch(error => { console.log('QA SCRIPT CRASHED:', error.stack.split('\n').slice(0, 4).join(' | ')); process.exitCode = 1; });
