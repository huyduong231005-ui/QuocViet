export type Role = 'admin' | 'buyer' | 'manager' | 'auditor';
export function can(role: Role, action: 'buy' | 'approve' | 'receive' | 'request'): boolean {
  if (role === 'admin') return true;
  return action === 'buy' ? role === 'buyer' : action === 'approve' ? role === 'manager' : action === 'receive' ? role === 'buyer' : role === 'buyer' || role === 'manager';
}
export function reciprocal(matrix: number[][], row: number, column: number, value: number): number[][] {
  if (!Number.isFinite(value) || value < 1 / 9 || value > 9) throw new Error('Giá trị Saaty phải nằm trong khoảng 1/9 đến 9.');
  const result = matrix.map(r => [...r]);
  if (row === column) { result[row][column] = 1; return result; }
  result[row][column] = value; result[column][row] = 1 / value; return result;
}
export function eligibleSession(session: {status: string; consistent: boolean; cr: number}, approved: boolean): boolean {
  return session.status === 'approved' && session.consistent && Number.isFinite(session.cr) && session.cr <= 0.1 && approved;
}
export function receiptPayload(values: Record<string, unknown>, key: string): Record<string, unknown> {
  return {...values, quantity: Number(values.quantity), acceptedQuantity: Number(values.acceptedQuantity), receivedAt: new Date(String(values.receivedAt)).toISOString(), idempotencyKey: key};
}
/** `today` is the server's business date (bootstrap.businessDate), never the browser's UTC day. */
export function isCurrentQuotation(expiry:string,today:string):boolean { return expiry.slice(0,10) >= today; }
export function reorderMatrix(matrix:number[][],oldIds:string[],newIds:string[]):number[][] {
  return newIds.map(a=>newIds.map(b=>matrix[oldIds.indexOf(a)]?.[oldIds.indexOf(b)]??1));
}
export function invitedSupplierOptions(suppliers:{id:string;name:string;active:boolean}[],rfq?:{supplierIds:string[]}):{value:string;label:string}[] {
  return suppliers.filter(s=>s.active&&rfq?.supplierIds.includes(s.id)).map(s=>({value:s.id,label:s.name}));
}

/** A document line as people read it: product name, its own unit, a quantity. */
export interface LineView {productId:string;name:string;unit:string;quantity:number}
export function describeLines(lines:{productId:string;quantity:number}[],products:{id:string;name:string;unit:string}[]):LineView[] {
  return lines.map(line=>{const product=products.find(p=>p.id===line.productId);return {productId:line.productId,name:product?.name??line.productId,unit:product?.unit??'',quantity:line.quantity};});
}
/** Quantities of different products are never added up: several lines are counted, not summed. */
export function linesLabel(lines:{name:string}[]):string { return lines.length===1?lines[0].name:`${lines.length} mặt hàng`; }
/** Lines of approved requests that have no RFQ yet. */
export function openRequestLines(requests:{id:string;status:string;items:{id:string;productId:string;quantity:number}[]}[],rfqs:{requestLineId:string}[]):{lineId:string;requestId:string;productId:string;quantity:number}[] {
  return requests.filter(r=>r.status==='approved').flatMap(r=>r.items.filter(item=>!rfqs.some(q=>q.requestLineId===item.id)).map(item=>({lineId:item.id,requestId:r.id,productId:item.productId,quantity:item.quantity})));
}
/** Approved sessions not yet ordered, grouped by the supplier gate 2 chose: each group can become one PO. */
export function poCandidates(sessions:{id:string;rfqId:string;status:string;consistent:boolean;cr:number}[],approvals:{gate:number;sessionId?:string;status:string;supplierId?:string}[],rfqs:{id:string;status:string}[]):{supplierId:string;sessionIds:string[]}[] {
  const groups=new Map<string,string[]>();
  for(const session of sessions){
    const approval=approvals.find(a=>a.gate===2&&a.sessionId===session.id);
    if(!approval?.supplierId||!eligibleSession(session,approval.status==='approved')||rfqs.find(q=>q.id===session.rfqId)?.status!=='open')continue;
    groups.set(approval.supplierId,[...(groups.get(approval.supplierId)??[]),session.id]);
  }
  return [...groups].map(([supplierId,sessionIds])=>({supplierId,sessionIds}));
}
/** Fully received POs that have no supplier evaluation yet. */
export function unratedOrders<T extends {id:string;status:string}>(orders:T[],evaluations:{orderId:string}[]):T[] {
  return orders.filter(o=>o.status==='received'&&!evaluations.some(e=>e.orderId===o.id));
}
/** One stop on the purchase line: how many documents wait there, and whether they wait for this role. */
export interface Station {key:'requests'|'quotes'|'ahp'|'choice'|'orders'|'evaluate';count:number;mine:boolean}
/** The purchase line as six stops, counted from the working set: requests to
 * approve, lines and RFQs still collecting quotations, AHP sessions not yet
 * submitted, supplier choices to approve, POs to raise or receive, and
 * received POs to evaluate. */
export function flowStations(data:{requests:{id:string;status:string;items:{id:string;productId:string;quantity:number}[]}[];rfqs:{id:string;requestLineId:string;status:string}[];ahpSessions:{id:string;rfqId:string;status:string;consistent:boolean;cr:number}[];approvals:{gate:number;sessionId?:string;status:string;supplierId?:string}[];orders:{id:string;status:string;sentAt?:string}[];evaluations:{orderId:string}[]},role:Role):Station[] {
  const openRfqs=data.rfqs.filter(q=>q.status==='open');
  const live=(rfqId:string)=>data.ahpSessions.some(s=>s.rfqId===rfqId&&s.status!=='stale');
  const active=data.orders.filter(o=>o.status!=='received'),toRaise=poCandidates(data.ahpSessions,data.approvals,data.rfqs).length;
  const stop=(key:Station['key'],count:number,mine:boolean):Station=>({key,count,mine:mine&&count>0});
  return [
    stop('requests',data.requests.filter(r=>r.status==='pending').length,can(role,'approve')),
    stop('quotes',openRequestLines(data.requests,data.rfqs).length+openRfqs.filter(q=>!live(q.id)).length,can(role,'buy')),
    stop('ahp',data.ahpSessions.filter(s=>s.status==='draft'&&openRfqs.some(q=>q.id===s.rfqId)).length,can(role,'buy')),
    stop('choice',data.approvals.filter(a=>a.gate===2&&a.status==='pending').length,can(role,'approve')),
    stop('orders',active.length+toRaise,can(role,'receive')&&active.length>0||can(role,'buy')&&(toRaise>0||active.some(o=>!o.sentAt))),
    stop('evaluate',unratedOrders(data.orders,data.evaluations).length,can(role,'buy')),
  ];
}
/** Receipt body for the lines actually delivered in this batch; untouched lines are left out. */
export function receiptItemsPayload(orderId:string,lines:{orderLineId:string;quantity?:number|null;acceptedQuantity?:number|null}[],receivedAt:string,notes:string,key:string) {
  const items=lines.filter(line=>Number(line.quantity)>0).map(line=>({orderLineId:line.orderLineId,quantity:Number(line.quantity),acceptedQuantity:Number(line.acceptedQuantity??0)}));
  return {orderId,receivedAt:new Date(receivedAt).toISOString(),idempotencyKey:key,notes,items};
}
