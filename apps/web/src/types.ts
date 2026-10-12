import type { Role } from './logic';
export interface Entity { id: string; createdAt: string; }
export interface User { id:string; name:string; email:string; role:Role; }
export interface Account extends User { active:boolean; createdAt:string; updatedAt?:string; }
export interface Product extends Entity { sku:string; name:string; unit:string; minStock:number; stock:number; }
export interface Supplier extends Entity { name:string; email:string; phone:string; reputation:number; active:boolean; }
export interface Price extends Entity { productId:string; supplierId:string; unitPrice:number; deliveryDays:number; qualityScore:number; }
export interface RequestLine { id:string; lineNo:number; productId:string; quantity:number; }
/** `productId` and `quantity` are present only when the request has a single line. */
export interface Request extends Entity { items:RequestLine[]; productId?:string; quantity?:number; reason:string; status:string; }
export interface Rfq extends Entity { quotationCount?:number; requestId:string; requestLineId:string; productId:string; quantity:number; supplierIds:string[]; status:string; }
export interface Quotation extends Entity { rfqId:string; supplierId:string; quantity:number; unitPrice:number; deliveryDays:number; qualityScore:number; vat:number; currency:string; validUntil:string; source?:string; }
export interface Criterion { id:string; name:string; type?:'cost'|'benefit'; children?:Criterion[]; matrix?:number[][]; }
export interface Ranking { supplierId:string; supplierName:string; score:number; localScores?:number[] | Record<string,number>; }
export interface Session extends Entity { rfqId:string; criteria:Criterion[]; flattenedCriteria?:Criterion[]; matrix:number[][]; weights:number[] | Record<string,number>; lambdaMax:number; ci:number; cr:number; consistent:boolean; ranking:Ranking[]; monteCarlo:{ iterations:number;seed:number;uncertainty:number;winProbabilities:{supplierId:string;probability:number}[];meanScores:unknown }; sensitivity:{criterionId:string;weight:number;weights:number[];ranking:Ranking[]}[]; status:string; quotationSnapshots?:Quotation[]; treeConsistency?:{id?:string;groupId?:string;name?:string;cr:number;consistent:boolean}[]; revision?:number; }
/** `lines`, `reason` and `decidedByName` come with list rows, so a decision can be shown without its request loaded. */
export interface Approval extends Entity {lines?:{productId:string;quantity:number}[];reason?:string;decidedByName?:string;gate:1|2;status:string;requestId:string;runId?:string;rfqId?:string;sessionId?:string;revision?:number;proposal?:string;supplierId?:string;comment?:string;decidedBy?:string;decidedAt?:string;}
export interface OrderLine {id:string;lineNo:number;requestId:string;rfqId:string;sessionId:string;productId:string;productSku:string;productName:string;unit:string;quantity:number;unitPrice:number;vat:number;deliveryDays:number;total:number;receivedQuantity:number;acceptedQuantity:number;}
export interface Order extends Entity {evaluated?:boolean;supplierId:string;items:OrderLine[];total:number;status:string;sentAt?:string;}
export interface ReceiptLine {productName?:string;productSku?:string;unit?:string;id:string;orderLineId:string;productId:string;quantity:number;acceptedQuantity:number;}
export interface Receipt extends Entity {supplierId?:string;orderId:string;items:ReceiptLine[];receivedAt:string;notes?:string;idempotencyKey:string;}
export interface Evaluation extends Entity {supplierId?:string;orderId:string;deliveryScore:number;qualityScore:number;serviceScore:number;overallScore:number;notes?:string;}
export interface Inventory {productId:string;sku:string;name:string;unit:string;stock:number;minStock:number;forecast:number;reorderQuantity:number;}
export interface Movement {id:string;productId:string;sku:string;productName:string;unit:string;kind:'OPENING'|'RECEIPT';delta:number;balanceAfter:number;createdAt:string;actorName:string;receiptId?:string;orderId?:string;supplierName?:string;}
export interface History extends Entity {productId:string;supplierId:string;month:string;quantity:number;unitPrice:number;onTime:boolean;qualityScore:number;}
export interface Run extends Entity {productId:string;quantity:number;status:string;stage:string;requestId?:string;rfqId?:string;sessionId?:string;orderId?:string;error?:string;tokensUsed:number;stepCount:number;}
export interface AgentStep extends Entity {runId:string;tool:string;stage:string;status:string;detail:unknown;}
export interface Audit extends Entity {actorId?:string;actor?:string;actorName?:string;role?:string;action:string;entityType?:string;entityId?:string;detail?:unknown;}
export interface Dashboard {totalProducts:number;totalSuppliers:number;pendingApprovals:number;activeOrders:number;inventoryValue:number|null;warnings:string[];monthlySpend:{month:string;value:number|null;historyValue:number|null;orderValue:number|null}[];supplierPerformance:{supplierId:string;name:string;score:number}[];forecast:{productId:string;name:string;forecast:number;stock:number;reorderQuantity:number}[];}
/** Master data plus the working set: documents still in progress and those created since `workspaceSince`. Older documents are read through the paged lists. */
/** `mailEnabled`: RFQ and PO mail really leaves; otherwise it is only queued. */
export interface Bootstrap {workspaceSince?:string;businessDate:string;demoMode?:boolean;mailEnabled?:boolean;agentEnabled?:boolean;extractionEnabled?:boolean;products:Product[];suppliers:Supplier[];prices:Price[];requests:Request[];rfqs:Rfq[];quotations:Quotation[];ahpSessions:Session[];orders:Order[];receipts:Receipt[];evaluations:Evaluation[];inventory:Inventory[];agentRuns:Run[];agentSteps:AgentStep[];approvals:Approval[];history:History[];criteria:Criterion[];dashboard:Dashboard;}
export interface AnomalyWarning { field?:string; level:'danger'|'warning'|'info'; message:string; diffPercent?:number; }
export interface Benchmark {
 hasHistory: boolean;
 supplier: { id:string; name:string; reputation:number; };
 product: { id:string; name:string; sku:string; unit:string; };
 baselinePrice?: number;
 baselineSource?: string;
 marketAvgPrice?: number;
 catalogPrice?: { unitPrice:number; deliveryDays:number; qualityScore:number; };
 recentQuotes?: { unitPrice:number; deliveryDays:number; createdAt:string; }[];
 recentEvaluations?: { overallScore:number; qualityScore:number; deliveryScore:number; createdAt:string; }[];
 priceComparison?: { currentPrice:number; baselinePrice:number; baselineSource:string; diffPercent:number; status:'cheaper'|'normal'|'slight_increase'|'high_increase'; };
 deliveryComparison?: { currentDays:number; baselineDays:number; status:'delayed'|'normal'; };
 warnings: AnomalyWarning[];
}
export interface Extraction {quotation:Partial<Quotation>;confidence:number;coverage?:number;missingFields?:string[];warnings:string[];method:string;tokensUsed?:number;llmStatus?:'used'|'failed'|'not_configured'|'rate_limited'|'skipped_sufficient'|'skipped_core_fields_present';evidence?:Record<string,string>;fieldSources?:Record<string,'parser'|'model'>;benchmark?:Benchmark;}
export interface AgentStatus {enabled:boolean;extractionEnabled:boolean;reachable:boolean;llmConfigured:boolean;ocrAvailable:boolean;model:string|null;provider:string|null;keyCount:number;}
