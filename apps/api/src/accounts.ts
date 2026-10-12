import {randomUUID} from 'node:crypto';
import {Database,Repository,RecordData} from './db';
import {Actor,hashPassword,verifyPassword} from './auth';
import {DomainError,databaseError,requireThat} from './errors';
import {parse,accountCreateSchema,accountUpdateSchema,passwordResetSchema,passwordChangeSchema,registerSchema} from './validation';

export interface PublicUser {id:string;name:string;email:string;role:string;active:boolean;createdAt:string;updatedAt?:string}
/** The only shape of a user that leaves this module: no hash, ever. */
const publicUser=(user:RecordData):PublicUser=>({id:user.id,name:user.name,email:user.email,role:user.role,active:user.active!==false,createdAt:user.createdAt,...(user.updatedAt?{updatedAt:user.updatedAt}:{})});

/** Account administration. An administrator creates accounts, changes roles,
 * deactivates and resets passwords; anyone may register, but a registered
 * account stays locked until an administrator activates it. Accounts are never
 * deleted, because documents and audit rows refer to them. */
export class Accounts {
 constructor(private db:Database){}
 async list(actor:Actor):Promise<PublicUser[]> {
  this.administrator(actor);
  return (await this.db.transaction(repo=>repo.list('users'),{readOnly:true})).map(publicUser);
 }
 async create(actor:Actor,body:unknown):Promise<PublicUser> {
  this.administrator(actor);const v=parse(accountCreateSchema,body,true);
  return this.write(actor,'account:create',async repo=>{
   requireThat(!(await repo.find('users',{email:v.email})).length,'Email này đã có tài khoản',409);
   const user=await repo.put('users',{id:randomUUID(),createdAt:new Date().toISOString(),name:v.name,email:v.email,role:v.role,active:true,demo:false,passwordHash:hashPassword(v.password)});
   return {user,detail:{role:v.role}};
  });
 }
 /** Self-registration. The account is created locked and with the least role (read-only),
  * so registering alone gives no access: an administrator activates it and sets the role. */
 async register(body:unknown):Promise<{registered:true}> {
  const v=parse(registerSchema,body,true);
  try{await this.db.transaction(async repo=>{
   requireThat(!(await repo.find('users',{email:v.email})).length,'Email này đã có tài khoản',409);
   const user=await repo.put('users',{id:randomUUID(),createdAt:new Date().toISOString(),name:v.name,email:v.email,role:'auditor',active:false,demo:false,passwordHash:hashPassword(v.password)});
   await repo.put('audit',{id:randomUUID(),createdAt:new Date().toISOString(),actorId:user.id,actorName:user.name,role:user.role,action:'account:register',entityType:'user',entityId:user.id,detail:{}});
  })}catch(error){if(error instanceof DomainError)throw error;throw databaseError(error)??error}
  return {registered:true};
 }
 async update(actor:Actor,id:string,body:unknown):Promise<PublicUser> {
  this.administrator(actor);const v=parse(accountUpdateSchema,body,true);
  return this.write(actor,'account:update',async repo=>{
   const current=await this.existing(repo,id),next={...current,...v};
   const wasAdmin=current.role==='admin'&&current.active!==false,staysAdmin=next.role==='admin'&&next.active!==false;
   if(wasAdmin&&!staysAdmin){
    requireThat(current.id!==actor.id,'Không thể tự khóa hoặc tự hạ quyền tài khoản đang đăng nhập');
    // Writes are serialized, so this count cannot be raced by another administrator's edit.
    requireThat((await repo.find('users',{role:'admin',active:true})).some(user=>user.id!==current.id),'Phải còn ít nhất một quản trị viên đang hoạt động');
   }
   const changes=Object.fromEntries((['name','role','active'] as const).filter(key=>v[key]!==undefined&&v[key]!==(key==='active'?current.active!==false:current[key])).map(key=>[key,{before:key==='active'?current.active!==false:current[key],after:v[key]}]));
   if(!Object.keys(changes).length)return {user:current,detail:{}};
   return {user:await repo.put('users',{...next,updatedAt:new Date().toISOString()}),detail:{changes}};
  });
 }
 /** Changing the hash also ends every session of that account (see Auth). */
 async resetPassword(actor:Actor,id:string,body:unknown):Promise<PublicUser> {
  this.administrator(actor);const v=parse(passwordResetSchema,body,true);
  return this.write(actor,'account:password',async repo=>({user:await repo.put('users',{...await this.existing(repo,id),passwordHash:hashPassword(v.password),updatedAt:new Date().toISOString()}),detail:{}}));
 }
 async changeOwnPassword(actor:Actor,body:unknown):Promise<PublicUser> {
  const v=parse(passwordChangeSchema,body,true);
  return this.write(actor,'account:password',async repo=>{
   const current=await this.existing(repo,actor.id);
   requireThat(verifyPassword(v.currentPassword,current.passwordHash),'Mật khẩu hiện tại không đúng');
   return {user:await repo.put('users',{...current,passwordHash:hashPassword(v.newPassword),updatedAt:new Date().toISOString()}),detail:{}};
  });
 }
 private administrator(actor:Actor){requireThat(actor.role==='admin','Chỉ quản trị viên được quản lý tài khoản',403)}
 private async existing(repo:Repository,id:string){const user=await repo.get('users',id);requireThat(user,'Không tìm thấy tài khoản',404);return user}
 /** One transaction per change, with an audit row that never carries a password, hash or token. */
 private async write(actor:Actor,action:string,change:(repo:Repository)=>Promise<{user:RecordData;detail:Record<string,unknown>}>):Promise<PublicUser> {
  try{return await this.db.transaction(async repo=>{
   const {user,detail}=await change(repo);
   await repo.put('audit',{id:randomUUID(),createdAt:new Date().toISOString(),actorId:actor.id,actorName:actor.name,role:actor.role,action,entityType:'user',entityId:user.id,detail});
   return publicUser(user);
  })}catch(error){if(error instanceof DomainError)throw error;throw databaseError(error)??error}
 }
}
