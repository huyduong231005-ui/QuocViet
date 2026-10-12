import test from 'node:test';
import assert from 'node:assert/strict';
import { can, reciprocal, eligibleSession, receiptPayload, isCurrentQuotation, reorderMatrix, invitedSupplierOptions, describeLines, linesLabel, openRequestLines, poCandidates, receiptItemsPayload, flowStations } from '../src/logic.ts';
test('buying and warehouse role can purchase and receive but cannot approve', () => {
  assert.equal(can('buyer', 'buy'), true); assert.equal(can('buyer', 'approve'), false);
  assert.equal(can('buyer', 'receive'), true);
  assert.equal(can('manager', 'receive'), false); assert.equal(can('auditor', 'receive'), false);
  assert.equal(can('manager', 'request'), true); assert.equal(can('auditor', 'request'), false);
});
test('editing one pair preserves reciprocity and the immutable previous matrix', () => {
  const original = [[1,1,1],[1,1,1],[1,1,1]];
  const result = reciprocal(original, 0, 2, 5);
  assert.deepEqual(result, [[1,1,5],[1,1,1],[0.2,1,1]]); assert.equal(original[0][2], 1);
  assert.throws(() => reciprocal(original,0,1,0)); assert.throws(() => reciprocal(original,0,1,NaN));
});
test('stale or inconsistent sessions cannot create an order even after approval', () => {
  assert.equal(eligibleSession({status:'stale',consistent:true,cr:0},true),false);
  assert.equal(eligibleSession({status:'draft',consistent:false,cr:0.2},true),false);
  assert.equal(eligibleSession({status:'draft',consistent:true,cr:0.01},false),false);
  assert.equal(eligibleSession({status:'pending_approval',consistent:true,cr:0.01},true),false);
  assert.equal(eligibleSession({status:'approved',consistent:true,cr:0.01},true),true);
});
test('receipt retry preserves its key and sends numeric quantities', () => {
  const payload = receiptPayload({orderId:'p1',quantity:'10',acceptedQuantity:'9',receivedAt:'2026-10-10T15:30:00+07:00',notes:'Đợt 1'},'same-key');
  assert.equal(payload.idempotencyKey,'same-key'); assert.equal(payload.quantity,10); assert.equal(payload.acceptedQuantity,9);
  assert.equal(payload.receivedAt,'2026-10-10T08:30:00.000Z');
});
test('quotation remains valid throughout its expiry calendar day', () => {
  assert.equal(isCurrentQuotation('2026-10-11','2026-10-11'),true);
  assert.equal(isCurrentQuotation('2026-10-10','2026-10-11'),false);
});
test('reordering criteria keeps each named comparison attached to its source', () => {
  assert.deepEqual(reorderMatrix([[1,3,5],[1/3,1,2],[.2,.5,1]],['a','b','c'],['c','a','b']),[[1,.2,.5],[5,1,3],[2,1/3,1]]);
});
test('manual and extracted quotations only offer active suppliers invited to the selected RFQ', () => {
  const suppliers = [{id:'a',name:'An Phát',active:true},{id:'b',name:'Minh Châu',active:true},{id:'c',name:'Thiên Long',active:false}];
  assert.deepEqual(invitedSupplierOptions(suppliers,{supplierIds:['b','c']}),[{value:'b',label:'Minh Châu'}]);
  assert.deepEqual(invitedSupplierOptions(suppliers,{supplierIds:['a']}),[{value:'a',label:'An Phát'}]);
  assert.deepEqual(invitedSupplierOptions(suppliers,undefined),[]);
});

test('several lines are counted, never summed across units', () => {
  const products = [{id:'a',name:'Giấy A4',unit:'ram'},{id:'b',name:'Mực in',unit:'hộp'}];
  const lines = describeLines([{productId:'a',quantity:100},{productId:'b',quantity:8},{productId:'x',quantity:1}], products);
  assert.deepEqual(lines.slice(0,2), [{productId:'a',name:'Giấy A4',unit:'ram',quantity:100},{productId:'b',name:'Mực in',unit:'hộp',quantity:8}]);
  assert.equal(lines[2].name,'x');
  assert.equal(linesLabel(lines.slice(0,1)),'Giấy A4'); assert.equal(linesLabel(lines),'3 mặt hàng');
});
test('only lines of approved requests without an RFQ are offered for a new RFQ', () => {
  const requests = [
    {id:'r1',status:'approved',items:[{id:'l1',productId:'a',quantity:1},{id:'l2',productId:'b',quantity:2}]},
    {id:'r2',status:'pending',items:[{id:'l3',productId:'a',quantity:3}]},
  ];
  assert.deepEqual(openRequestLines(requests,[{requestLineId:'l1'}]),[{lineId:'l2',requestId:'r1',productId:'b',quantity:2}]);
});
test('PO candidates group approved, still-open sessions by the chosen supplier', () => {
  const session = (id:string,rfqId:string,status='approved') => ({id,rfqId,status,consistent:true,cr:0.01});
  const sessions = [session('s1','q1'),session('s2','q2'),session('s3','q3'),session('s4','q4','stale'),session('s5','q5')];
  const approvals = [
    {gate:2,sessionId:'s1',status:'approved',supplierId:'A'},{gate:2,sessionId:'s2',status:'approved',supplierId:'B'},
    {gate:2,sessionId:'s3',status:'approved',supplierId:'A'},{gate:2,sessionId:'s4',status:'approved',supplierId:'A'},
    {gate:2,sessionId:'s5',status:'approved',supplierId:'A'},
  ];
  const rfqs = [{id:'q1',status:'open'},{id:'q2',status:'open'},{id:'q3',status:'open'},{id:'q4',status:'open'},{id:'q5',status:'closed'}];
  assert.deepEqual(poCandidates(sessions,approvals,rfqs),[{supplierId:'A',sessionIds:['s1','s3']},{supplierId:'B',sessionIds:['s2']}]);
});
test('a receipt sends only the lines delivered in this batch and keeps its retry key', () => {
  const payload = receiptItemsPayload('po',[{orderLineId:'l1',quantity:40,acceptedQuantity:38},{orderLineId:'l2',quantity:0,acceptedQuantity:0},{orderLineId:'l3',quantity:null}],'2026-10-10T15:30:00+07:00','Đợt 1','same-key');
  assert.deepEqual(payload,{orderId:'po',receivedAt:'2026-10-10T08:30:00.000Z',idempotencyKey:'same-key',notes:'Đợt 1',items:[{orderLineId:'l1',quantity:40,acceptedQuantity:38}]});
});
test('the purchase line counts what waits at each stop and marks the stops waiting for this role', () => {
  const data = {
    requests: [{id:'r1',status:'pending',items:[{id:'l1',productId:'p',quantity:1}]},{id:'r2',status:'approved',items:[{id:'l2',productId:'p',quantity:1},{id:'l3',productId:'q',quantity:2}]}],
    rfqs: [{id:'q1',requestLineId:'l2',status:'open'},{id:'q2',requestLineId:'x',status:'open'},{id:'q3',requestLineId:'y',status:'closed'}],
    ahpSessions: [{id:'s1',rfqId:'q2',status:'draft',consistent:true,cr:0},{id:'s0',rfqId:'q1',status:'stale',consistent:true,cr:0}],
    approvals: [{gate:1,status:'pending'},{gate:2,status:'pending',sessionId:'s9'}],
    orders: [{id:'o1',status:'ordered'},{id:'o2',status:'partially_received',sentAt:'2026-10-11'},{id:'o3',status:'received'},{id:'o4',status:'received'}],
    evaluations: [{orderId:'o4'}],
  };
  const stops = (role: Parameters<typeof flowStations>[1]) => Object.fromEntries(flowStations(data, role).map(s => [s.key, [s.count, s.mine]]));
  // l3 has no RFQ yet and q1 has only a stale session, so two things still need quotations.
  assert.deepEqual(stops('manager'), {requests:[1,true],quotes:[2,false],ahp:[1,false],choice:[1,true],orders:[2,false],evaluate:[1,false]});
  assert.deepEqual(stops('buyer'), {requests:[1,false],quotes:[2,true],ahp:[1,true],choice:[1,false],orders:[2,true],evaluate:[1,true]});
  assert.deepEqual(stops('buyer').orders, [2,true]);
  assert.equal(flowStations({...data,orders:[]}, 'buyer')[4].mine, false);
});
