import { createHash,randomBytes,scryptSync,timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Database } from './db';
import {DomainError} from './errors';
export interface Actor {id:string;name:string;role:string;email?:string}
export function hashPassword(password:string){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex')}
export function verifyPassword(password:string,hash:string){const [salt,key]=hash.split(':');if(!salt||!key)return false;const candidate=scryptSync(password,salt,64),known=Buffer.from(key,'hex');return known.length===candidate.length&&timingSafeEqual(known,candidate)}
/** Carried in the token and compared on every request: once the stored hash
 * changes (reset or change of password), earlier tokens stop working. It is a
 * truncated digest of the hash, so it reveals neither password nor hash. */
const passwordVersion=(hash:string)=>createHash('sha256').update(hash).digest('hex').slice(0,16);
export class Auth {
 constructor(private db:Database,private secret:string){}
 async login(email:string,password:string){
  if(typeof email!=='string'||typeof password!=='string'||password.length>256)throw new DomainError('Thông tin đăng nhập không hợp lệ',401);
  const [user]=await this.db.transaction(r=>r.find('users',{email}),{readOnly:true});
  if(!user||user.active===false||!verifyPassword(password,user.passwordHash))throw new DomainError('Email hoặc mật khẩu không đúng',401);
  const actor:Actor={id:user.id,name:user.name,email:user.email,role:user.role};return {token:jwt.sign({...actor,pv:passwordVersion(user.passwordHash)},this.secret,{expiresIn:'8h',issuer:'procureiq',audience:'procureiq-web'}),user:actor};
 }
 async authenticate(header?:string):Promise<Actor>{
  try {if(!header?.startsWith('Bearer '))throw new Error();const claim=jwt.verify(header.slice(7),this.secret,{algorithms:['HS256'],issuer:'procureiq',audience:'procureiq-web'}) as Actor&{pv?:string};const user=await this.db.transaction(r=>r.get('users',claim.id),{readOnly:true});if(!user||user.active===false||user.role!==claim.role||claim.pv!==passwordVersion(user.passwordHash))throw new Error();return {id:user.id,name:user.name,role:user.role,email:user.email}}
  catch{throw new DomainError('Phiên đăng nhập không hợp lệ hoặc đã hết hạn',401)}
 }
}
