import {requireThat} from './errors';
/** Integer VND, VAT represented in basis points. Round only the final total. */
export function totalMoney(quantity:number,unitPrice:number,vat:number){
 requireThat(Number.isSafeInteger(quantity)&&quantity>0&&Number.isSafeInteger(unitPrice)&&unitPrice>0,'Số lượng và đơn giá VND phải là số nguyên dương');
 requireThat(Number.isFinite(vat)&&vat>=0&&vat<=100&&Math.abs(vat*100-Math.round(vat*100))<1e-7,'VAT chỉ được tối đa hai chữ số thập phân');
 const numerator=BigInt(quantity)*BigInt(unitPrice)*(10000n+BigInt(Math.round(vat*100))),total=(numerator+5000n)/10000n;
 requireThat(total<=BigInt(Number.MAX_SAFE_INTEGER),'Số tiền vượt giới hạn chính xác của hệ thống');return Number(total);
}
