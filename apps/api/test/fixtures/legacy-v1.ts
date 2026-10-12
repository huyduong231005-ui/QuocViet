import {scryptSync} from 'node:crypto';

// Independent pre-migration API records. No new repository/service generates
// the oracle. The test hash uses a fixed fixture salt and a public test password.
const at='2026-10-01T00:00:00.000Z',later='2026-10-02T00:00:00.000Z';
const row=(id:string,data:object)=>({id,createdAt:at,...data});
const salt='00000000000000000000000000000000';
export const fixtureAdminHash=`${salt}:${scryptSync('Fixture@12345',salt,64).toString('hex')}`;
const quoteZ=row('quote-z',{rfqId:'rfq',supplierId:'supplier-z',quantity:20,unitPrice:10001,vat:8.25,currency:'VND',deliveryDays:3,qualityScore:92,validUntil:'2099-12-31',source:'legacy-fixture'});
const quoteA=row('quote-a',{rfqId:'rfq',supplierId:'supplier-a',quantity:20,unitPrice:11000,vat:8.25,currency:'VND',deliveryDays:2,qualityScore:90,validUntil:'2099-12-31',source:'legacy-fixture',updatedAt:later});
const snapshotZ={...quoteZ,supplierName:'Z Supplier',criterionInputs:{price:10826.0825,quality:92,delivery:3,reputation:95}};
const snapshotA={...quoteA,supplierName:'A Supplier',criterionInputs:{price:11907.5,quality:90,delivery:2,reputation:90}};
const math={rfqId:'rfq',runId:'run',revision:1,criteria:[{id:'price',name:'Price',type:'cost'},{id:'quality',name:'Quality',type:'benefit'}],matrix:[[1,2],[.5,1]],weights:[2/3,1/3],lambdaMax:2,ci:0,cr:0,consistent:true,flattenedCriteria:[{id:'price',name:'Price',type:'cost'},{id:'quality',name:'Quality',type:'benefit'}],treeConsistency:[{id:'root',cr:0,consistent:true}],ranking:[{supplierId:'supplier-z',supplierName:'Z Supplier',score:.6},{supplierId:'supplier-a',supplierName:'A Supplier',score:.4}],monteCarlo:{iterations:100,seed:42,uncertainty:.15,distribution:'log-uniform multiplicative noise',winProbabilities:[{supplierId:'supplier-z',probability:.7},{supplierId:'supplier-a',probability:.3}],meanScores:[{supplierId:'supplier-z',score:.6},{supplierId:'supplier-a',score:.4}]},sensitivity:[{criterionId:'price',weight:.5,weights:[.5,.5],ranking:[]}],quotationSnapshots:[snapshotZ,snapshotA]};
const input={orderId:'order',quantity:10,acceptedQuantity:9,receivedAt:'2026-10-02T07:08:09+07:00',idempotencyKey:'legacy-receipt',notes:'Retain the offset exactly'};
export const legacyV1Fixture={
 users:['admin','buyer','manager','warehouse'].map(role=>row(`u-${role}`,{name:role,email:`${role}@fixture.example`,role,passwordHash:fixtureAdminHash,demo:false})),
 products:[row('product',{sku:'PAPER',name:'Paper',unit:'box',stock:129,minStock:200}),row('empty-product',{sku:'EMPTY',name:'Empty',unit:'box',stock:0,minStock:3})],
 suppliers:[row('supplier-z',{name:'Z Supplier',email:'z@example.test',phone:'0900000001',reputation:95,active:true}),row('supplier-a',{name:'A Supplier',email:'a@example.test',phone:'0900000002',reputation:90,active:true})],
 prices:[row('price',{productId:'product',supplierId:'supplier-z',unitPrice:10001,deliveryDays:3,qualityScore:92,updatedAt:later})],
 requests:[row('request',{productId:'product',quantity:10,reason:'Legacy Agent need',status:'approved',createdBy:'agent',runId:'run'})],
 rfqs:[row('rfq',{requestId:'request',productId:'product',quantity:10,supplierIds:['supplier-z','supplier-a'],status:'open',runId:'run'})],
 quotations:[quoteZ,quoteA],
 ahp_sessions:[row('session-1',{...math,status:'stale'}),row('session-2',{...math,status:'approved',updatedAt:later})],
 approvals:[row('gate-1',{gate:1,status:'approved',requestId:'request',runId:'run',proposal:'Buy ten',comment:'Approved',decidedBy:'u-manager',decidedAt:later}),row('gate-2',{gate:2,status:'approved',requestId:'request',rfqId:'rfq',sessionId:'session-2',revision:1,supplierId:'supplier-z',runId:'run',proposal:'Select Z',comment:'Approved',decidedBy:'u-manager',decidedAt:later})],
 orders:[row('order',{requestId:'request',rfqId:'rfq',sessionId:'session-2',supplierId:'supplier-z',productId:'product',quantity:10,unitPrice:10001,vat:8.25,total:108261,deliveryDays:3,status:'received',receivedQuantity:10,acceptedQuantity:9,runId:'run',quotationSnapshot:snapshotZ,sentAt:later})],
 receipts:[row('receipt',{...input,input,productId:'product',supplierId:'supplier-z',createdBy:'u-warehouse'})],
 evaluations:[row('evaluation',{orderId:'order',supplierId:'supplier-z',productId:'product',reportedQualityScore:90,acceptanceScore:90,qualityScore:90,deliveryScore:100,serviceScore:95,overallScore:94,notes:'Legacy feedback',createdBy:'u-buyer'})],
 agent_runs:[row('run',{productId:'product',requestId:'request',rfqId:'rfq',sessionId:'session-2',orderId:'order',status:'completed',stage:4,createdBy:'u-buyer',quantity:10,tokensUsed:42,stepCount:9,demo:false,usageIds:['usage-1'],updatedAt:later})],
 agent_steps:[row('step',{runId:'run',tool:'finalize',stage:4,status:'completed',detail:'Original plain string'})],
 history:[row('hist-0-0',{productId:'product',supplierId:'supplier-z',month:'2026-09',quantity:10,unitPrice:10001,onTime:false,qualityScore:90,synthetic:false})],
 audit:[row('audit-human',{actorId:'u-manager',actorName:'Manager',role:'manager',action:'decide',entityType:'approvals',entityId:'gate-2',detail:{approved:true,comment:'Approved'}}),row('audit-agent',{actorId:'agent',actorName:'AI Agent',role:'agent',action:'tool:finalize',entityId:'run'})],
 outbox:[row('mail-rfq',{messageKey:'rfq:rfq:supplier-z',type:'RFQ',rfqId:'rfq',supplierId:'supplier-z',to:'z@example.test',subject:'RFQ',text:'Offer requested',status:'sent',updatedAt:later}),row('mail-po',{messageKey:'po:order',type:'PO',orderId:'order',supplierId:'supplier-z',to:'z@example.test',subject:'PO',text:'Order approved',status:'sent'})],
};
