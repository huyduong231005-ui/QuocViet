import 'reflect-metadata';
import {Module,CanActivate,ExecutionContext,Injectable,Inject,Catch,ExceptionFilter,ArgumentsHost,HttpException} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {NestExpressApplication} from '@nestjs/platform-express';
import {json} from 'express';
import {timingSafeEqual} from 'node:crypto';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {Database} from './db';
import {Auth} from './auth';
import {Accounts} from './accounts';
import {Procurement} from './procurement';
import {ApiController,Runtime} from './controller';
import {DomainError,databaseError} from './errors';
import {mailerFromEnv} from './mailer';

@Catch()
class Errors implements ExceptionFilter {
 catch(raw:any,host:ArgumentsHost){const error=databaseError(raw)??raw;const response=host.switchToHttp().getResponse();const status=error instanceof DomainError?error.statusCode:error instanceof HttpException?error.getStatus():400;const message=error instanceof DomainError||error instanceof HttpException?error.message:error.code?'Dữ liệu không hợp lệ hoặc có xung đột':error.message||'Yêu cầu không hợp lệ';response.status(status).json({statusCode:status,message})}
}
@Injectable()
class Access implements CanActivate {
 constructor(@Inject(Auth)private auth:Auth,@Inject(Runtime)private runtime:Runtime){}
 async canActivate(context:ExecutionContext){
  const req=context.switchToHttp().getRequest(),path=req.path;
  if(path==='/api/health'||path==='/api/auth/login'||path==='/api/auth/register')return true;
  if(path.startsWith('/api/agent/tools/')){const key=req.headers['x-agent-key'];if(typeof key!=='string'||Buffer.byteLength(key)!==Buffer.byteLength(this.runtime.agentKey)||!timingSafeEqual(Buffer.from(key),Buffer.from(this.runtime.agentKey)))throw new DomainError('Agent key không hợp lệ',401);if(!this.runtime.agentEnabled)throw new DomainError('Agent dành cho giai đoạn triển khai sau',403);return true}
  req.actor=await this.auth.authenticate(req.headers.authorization);return true;
 }
}
export interface AppOptions {dataDir?:string;databaseUrl?:string;demo?:boolean;secret?:string;agentEnabled?:boolean;agentKey?:string;logger?:boolean}
export async function createApp(options:AppOptions={}) {
 const demo=options.demo??process.env.DEMO_MODE!=='false',secret=options.secret||process.env.JWT_SECRET||(demo?'local-demo-jwt-secret-change-before-deployment':'');
 if(!demo&&(!secret||secret.length<32||!process.env.ADMIN_EMAIL||!process.env.ADMIN_PASSWORD))throw new Error('Production cần JWT_SECRET >=32 ký tự, ADMIN_EMAIL, ADMIN_PASSWORD');
 const root=resolve(__dirname,'../../..'),db=await Database.open(options.dataDir||process.env.DATA_DIR||resolve(root,'.data/postgres'),options.databaseUrl||process.env.DATABASE_URL);
 const service=new Procurement(db,demo);service.mailer=mailerFromEnv();service.sender=process.env.MAIL_FROM_NAME||service.sender;await service.initialize();const auth=new Auth(db,secret),runtime=new Runtime(options.agentEnabled??process.env.AGENT_ENABLED==='true',options.agentKey||process.env.AGENT_API_KEY||'local-demo-agent-key');
 if(!demo&&runtime.agentEnabled&&runtime.agentKey==='local-demo-agent-key')throw new Error('Production cần AGENT_API_KEY riêng');
 @Module({controllers:[ApiController],providers:[{provide:Procurement,useValue:service},{provide:Auth,useValue:auth},{provide:Accounts,useValue:new Accounts(db)},{provide:Runtime,useValue:runtime},Access]})class AppModule{}
 const app=await NestFactory.create<NestExpressApplication>(AppModule,{logger:options.logger?['error','warn','log']:false,bodyParser:false});
 app.setGlobalPrefix('api');app.use(json({limit:'10mb'}));app.useGlobalGuards(app.get(Access));app.useGlobalFilters(new Errors());
 app.enableCors({origin:(process.env.WEB_ORIGIN||'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173').split(','),credentials:false});
 const attempts=new Map<string,{count:number,until:number}>();app.use((req:any,res:any,next:any)=>{if((req.path==='/api/auth/login'||req.path==='/api/auth/register')&&req.method==='POST'){const ip=req.ip||'local',now=Date.now();let entry=attempts.get(ip);if(!entry||entry.until<now){entry={count:0,until:now+300000};attempts.set(ip,entry)}if(++entry.count>30)return res.status(429).json({statusCode:429,message:'Quá nhiều lần đăng nhập; thử lại sau 5 phút'});if(attempts.size>10000)for(const [k,v] of attempts)if(v.until<now)attempts.delete(k)}next()});
 const frontend=resolve(root,'apps/web/dist');if(existsSync(frontend))app.useStaticAssets(frontend);
 return {app,db,service};
}
