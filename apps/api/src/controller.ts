import {Controller,Get,Post,Patch,Delete,Body,Param,Query,Req,Res,Inject} from '@nestjs/common';
import {Auth} from './auth';
import {Accounts} from './accounts';
import {Procurement} from './procurement';
import {DomainError,requireThat} from './errors';
import {buildExcel,buildPdf} from './reports';
import {buildSampleCatalog,parseCatalog} from './catalog-import';
export class Runtime {constructor(public agentEnabled:boolean,public agentKey:string){} }
@Controller()
export class ApiController {
 constructor(@Inject(Procurement)private service:Procurement,@Inject(Auth)private auth:Auth,@Inject(Runtime)private runtime:Runtime,@Inject(Accounts)private accounts:Accounts){}
 @Get('health')health(){return {status:'ok',service:'procureiq-api',agentEnabled:this.runtime.agentEnabled,demoMode:this.service.demo}}
 @Post('auth/login')login(@Body()body:any){return this.auth.login(body.email,body.password)}
 @Post('auth/register')register(@Body()b:any){return this.accounts.register(b)}
 @Post('auth/password')ownPassword(@Req()r:any,@Body()b:any){return this.accounts.changeOwnPassword(r.actor,b)}
 @Get('accounts')accountList(@Req()r:any){return this.accounts.list(r.actor)}
 @Post('accounts')accountCreate(@Req()r:any,@Body()b:any){return this.accounts.create(r.actor,b)}
 @Patch('accounts/:id')accountUpdate(@Req()r:any,@Body()b:any,@Param('id')id:string){return this.accounts.update(r.actor,id,b)}
 @Post('accounts/:id/password')accountPassword(@Req()r:any,@Body()b:any,@Param('id')id:string){return this.accounts.resetPassword(r.actor,id,b)}
 @Get('bootstrap')async bootstrap(){return {...await this.service.bootstrap(false),agentEnabled:this.runtime.agentEnabled}}
 @Get('audit')audit(@Query()q:any){return this.service.auditLog(q)}
 @Get('list/:kind')documents(@Param('kind')kind:string,@Query()q:any){return this.service.documents(kind,q)}
 @Get('inventory/movements')movements(@Query()q:any){return this.service.stockMovements(q)}
 @Post('products')products(@Req()r:any,@Body()b:any){return this.service.act('catalog:products:create',r.actor,b)}
 @Patch('products/:id')productsUpdate(@Req()r:any,@Body()b:any,@Param('id')id:string){return this.service.act('catalog:products:update',r.actor,b,id)}
 @Delete('products/:id')productsDelete(@Req()r:any,@Param('id')id:string){return this.service.act('catalog:products:delete',r.actor,{},id)}
 @Post('suppliers')suppliers(@Req()r:any,@Body()b:any){return this.service.act('catalog:suppliers:create',r.actor,b)}
 @Patch('suppliers/:id')suppliersUpdate(@Req()r:any,@Body()b:any,@Param('id')id:string){return this.service.act('catalog:suppliers:update',r.actor,b,id)}
 @Delete('suppliers/:id')suppliersDelete(@Req()r:any,@Param('id')id:string){return this.service.act('catalog:suppliers:delete',r.actor,{},id)}
 @Post('prices')prices(@Req()r:any,@Body()b:any){return this.service.act('catalog:prices:create',r.actor,b)}
 @Patch('prices/:id')pricesUpdate(@Req()r:any,@Body()b:any,@Param('id')id:string){return this.service.act('catalog:prices:update',r.actor,b,id)}
 @Delete('prices/:id')pricesDelete(@Req()r:any,@Param('id')id:string){return this.service.act('catalog:prices:delete',r.actor,{},id)}
 @Get('catalog/template')async catalogTemplate(@Res()response:any){response.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="danh-muc-mau.xlsx"'}).send(await buildSampleCatalog())}
 /** `commit:false` validates the whole file and writes nothing; the same file is then sent again with `commit:true`. */
 @Post('catalog/import')async catalogImport(@Req()r:any,@Body()b:any){
  requireThat(typeof b?.fileBase64==='string'&&b.fileBase64.length>0,'Chưa có file để nhập');
  let file;try{file=await parseCatalog(Buffer.from(b.fileBase64,'base64'))}catch(error:any){throw new DomainError(error.message)}
  return this.service.importCatalog(r.actor,file,b.commit===true);
 }
 @Post('requests')request(@Req()r:any,@Body()b:any){return this.service.act('request',r.actor,b)}
 @Post('requests/:id/approve')async requestApprove(@Req()r:any,@Body()b:any,@Param('id')id:string){const a=await this.service.act('requestApprove',r.actor,b,id);return this.afterDecision(a)}
 @Post('approvals/:id/decide')async decide(@Req()r:any,@Body()b:any,@Param('id')id:string){const a=await this.service.act('decide',r.actor,b,id);return this.afterDecision(a)}
 @Post('rfqs')rfq(@Req()r:any,@Body()b:any){return this.service.act('rfq',r.actor,b)}
 @Post('quotations')quotation(@Req()r:any,@Body()b:any){return this.service.act('quotation',r.actor,b)}
 @Patch('quotations/:id')quotationUpdate(@Req()r:any,@Body()b:any,@Param('id')id:string){return this.service.act('quotationUpdate',r.actor,b,id)}
 @Post('quotations/extract')async extract(@Req()r:any,@Body()b:any){
  requireThat(['buyer','admin'].includes(r.actor.role),'Bạn không có quyền trích xuất báo giá',403);requireThat(this.runtime.agentEnabled,'Trích xuất AI được tích hợp trong giai đoạn agent sau',403);
  const result=await this.agent('/extract',{text:b.text,fileBase64:b.fileBase64,mimeType:b.mimeType});return {...result,quotation:{...result.quotation,rfqId:b.rfqId,supplierId:b.supplierId}};
 }
 @Post('ahp/compute')ahp(@Req()r:any,@Body()b:any){return this.service.act('ahp',r.actor,b)}
 @Post('ahp/sessions/:id/request-approval')approval(@Req()r:any,@Param('id')id:string){return this.service.act('approval2',r.actor,{},id)}
 @Post('orders')order(@Req()r:any,@Body()b:any){return this.service.act('order',r.actor,b)}
 @Post('orders/:id/send')send(@Req()r:any,@Param('id')id:string){return this.service.act('send',r.actor,{},id)}
 @Post('receipts')receipt(@Req()r:any,@Body()b:any){return this.service.act('receipt',r.actor,b)}
 @Post('evaluations')evaluation(@Req()r:any,@Body()b:any){return this.service.act('evaluation',r.actor,b)}
 @Get('reports/excel')async excel(@Res()response:any){const buffer=await buildExcel(await this.service.bootstrap());response.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="procureiq-report.xlsx"'}).send(buffer)}
 @Get('reports/pdf')async pdf(@Res()response:any){const buffer=await buildPdf(await this.service.bootstrap());response.set({'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="procureiq-report.pdf"'}).send(buffer)}
 @Post('agent/runs')async startAgent(@Req()r:any,@Body()b:any){requireThat(this.runtime.agentEnabled,'Agent dành cho giai đoạn triển khai sau',403);const run=await this.service.act('startAgent',r.actor,b);try{await this.agent('/runs/start',{runId:run.id,productId:run.productId,quantity:run.quantity})}catch(error:any){await this.service.tool('report_error',{runId:run.id,error:error.message})}return (await this.service.tool('get_run',{runId:run.id})).run}
 @Post('agent/runs/:id/resume')async resume(@Req()r:any,@Param('id')id:string){requireThat(['admin','buyer'].includes(r.actor.role),'Bạn không có quyền tiếp tục agent',403);requireThat(this.runtime.agentEnabled,'Agent dành cho giai đoạn triển khai sau',403);await this.agent('/runs/resume',{runId:id});return (await this.service.tool('get_run',{runId:id})).run}
 @Post('agent/tools/:tool')tool(@Param('tool')name:string,@Body()b:any){return this.service.tool(name,b)}
 private async agent(path:string,body:any){
  try{const response=await fetch((process.env.AGENT_URL||'http://127.0.0.1:8001')+path,{method:'POST',headers:{'Content-Type':'application/json','X-Agent-Key':this.runtime.agentKey},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});const data:any=await response.json();if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:data.message||'Agent service trả lỗi');return data}
  catch(error:any){throw new DomainError(`Không kết nối được agent: ${error.message}`,503)}
 }
 private async afterDecision(approval:any){if(approval.runId&&approval.status==='approved'&&this.runtime.agentEnabled){try{await this.agent('/runs/resume',{runId:approval.runId})}catch(error:any){return {...approval,resumeError:error.message}}}return approval}
}
