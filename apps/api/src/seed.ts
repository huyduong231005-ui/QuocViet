import {Repository} from './db';
import {hashPassword} from './auth';
import {requireThat} from './errors';
export async function seed(repo:Repository,demo=true){
 const users=await repo.list('users');
 if(users.length){requireThat(demo||!users.some(u=>u.demo===true||(u.demo===undefined&&u.email.endsWith('@ahp.local'))),'Không dùng CSDL demo cho production. Hãy cấu hình DATABASE_URL hoặc DATA_DIR mới.');return}
 const now=new Date().toISOString();
 const roles=demo?['admin','buyer','manager','auditor']:['admin'];
 for(const role of roles)await repo.put('users',{id:`u-${role}`,createdAt:now,demo,name:({admin:'Quản trị viên',buyer:'Nhân viên mua hàng & kho',manager:'Quản lý',auditor:'Kiểm toán'} as any)[role],role,email:demo?`${role}@ahp.local`:process.env.ADMIN_EMAIL,passwordHash:hashPassword(demo?(process.env.DEMO_PASSWORD||'Demo@12345'):process.env.ADMIN_PASSWORD!)});
 if(!demo)return;
 const products=[{id:'pro-paper',sku:'VP-A4-80',name:'Giấy A4 Double A 80gsm',unit:'ram',stock:120,minStock:200},{id:'pro-toner',sku:'VP-TN-12A',name:'Mực in HP 12A',unit:'hộp',stock:18,minStock:20},{id:'pro-pen',sku:'VP-BP-01',name:'Bút bi Thiên Long',unit:'hộp',stock:48,minStock:30},{id:'pro-folder',sku:'VP-FL-A4',name:'Bìa hồ sơ A4',unit:'cái',stock:350,minStock:200},{id:'pro-tape',sku:'VP-TP-48',name:'Băng keo 48mm',unit:'cuộn',stock:65,minStock:50}];
 const suppliers=[{id:'sup-anphat',name:'Văn phòng phẩm An Phát',email:'anphat@example.test',phone:'0901234567',reputation:94,active:true},{id:'sup-minhchau',name:'Minh Châu Trading',email:'minhchau@example.test',phone:'0902345678',reputation:89,active:true},{id:'sup-thienlong',name:'Thiên Long Supply',email:'thienlong@example.test',phone:'0903456789',reputation:96,active:true}];
 for(const p of products)await repo.put('products',{...p,createdAt:now});for(const s of suppliers)await repo.put('suppliers',{...s,createdAt:now});
 const base=[68000,280000,46000,7000,14000];
 for(let pi=0;pi<products.length;pi++)for(let si=0;si<suppliers.length;si++)await repo.put('prices',{id:`price-${pi}-${si}`,createdAt:now,productId:products[pi].id,supplierId:suppliers[si].id,unitPrice:Math.round(base[pi]*(1+si*.045)),deliveryDays:3-si,qualityScore:92+si*2});
 for(let m=0;m<24;m++)for(let pi=0;pi<products.length;pi++){
  const date=new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth()-24+m,1));const month=date.toISOString().slice(0,7),si=(m+pi)%3;
  await repo.put('history',{id:`hist-${m}-${pi}`,createdAt:date.toISOString(),month,productId:products[pi].id,supplierId:suppliers[si].id,quantity:Math.round([420,24,60,250,80][pi]*(1+Math.sin(m*.7)*.15)),unitPrice:Math.round(base[pi]*(.95+m*.002)),onTime:m%7!==0,qualityScore:90+(m%9),synthetic:true});
 }
}
