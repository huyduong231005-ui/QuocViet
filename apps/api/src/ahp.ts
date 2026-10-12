/** AHP calculations are deterministic backend code, never model output. */
export type Direction = 'cost' | 'benefit';
export interface Criterion { id: string; name: string; type?: Direction; children?: Criterion[]; matrix?: number[][] }
export interface Alternative { supplierId: string; supplierName: string; values: number[] }
const RI = [0, 0, 0, .58, .90, 1.12, 1.24, 1.32, 1.41, 1.45, 1.49];
const normalize = (v: number[]) => { const sum=v.reduce((a,b)=>a+b,0); if(!Number.isFinite(sum)||sum<=0)throw new Error('Vector trọng số không hợp lệ');return v.map(x=>x/sum) };

export function eigenWeights(matrix: number[][]) {
 const n=matrix.length;
 if(n<1||n>10||matrix.some(row=>row.length!==n))throw new Error('Ma trận vuông phải có 1 đến 10 tiêu chí');
 for(let i=0;i<n;i++)for(let j=0;j<n;j++) {
  const a=matrix[i][j];
  if(!Number.isFinite(a)||a<=0||a<1/9-1e-9||a>9+1e-9)throw new Error('So sánh phải nằm trong thang Saaty 1/9 đến 9');
  if(i===j&&Math.abs(a-1)>1e-9)throw new Error('Đường chéo ma trận phải bằng 1');
  if(Math.abs(a*matrix[j][i]-1)>1e-7)throw new Error('Ma trận phải đối ứng aij = 1/aji');
 }
 let weights=Array<number>(n).fill(1/n), converged=false;
 for(let k=0;k<10000;k++) {
  const next=normalize(matrix.map(row=>row.reduce((sum,a,j)=>sum+a*weights[j],0)));
  const diff=Math.max(...next.map((w,i)=>Math.abs(w-weights[i])));weights=next;
  if(diff<1e-12){converged=true;break}
 }
 if(!converged)throw new Error('Vector riêng không hội tụ');
 const lambdaMax=matrix.map(row=>row.reduce((s,a,j)=>s+a*weights[j],0)).reduce((s,a,i)=>s+a/weights[i],0)/n;
 const ci=n<=2?0:Math.max(0,(lambdaMax-n)/(n-1)),cr=n<=2?0:ci/RI[n];
 return {weights,lambdaMax,ci,cr,consistent:cr<=.1};
}

export function flattenCriteria(criteria: Criterion[], matrix: number[][]) {
 const leaves:Criterion[]=[],weights:number[]=[],treeConsistency:{groupId:string;cr:number;consistent:boolean}[]=[],seen=new Set<string>();
 const visit=(nodes:Criterion[],m:number[][],parent:number,groupId:string,depth:number)=>{
  if(depth>5||nodes.length!==m.length)throw new Error('Cây tiêu chí và ma trận không khớp hoặc quá sâu');
  const r=eigenWeights(m);treeConsistency.push({groupId,cr:r.cr,consistent:r.consistent});
  nodes.forEach((node,i)=>{
   if(!node.id||!node.name||seen.has(node.id))throw new Error('Mỗi tiêu chí cần mã duy nhất và tên');seen.add(node.id);
   if(node.children?.length){if(!node.matrix)throw new Error('Nhóm tiêu chí cần ma trận so sánh');visit(node.children,node.matrix,parent*r.weights[i],node.id,depth+1)}
   else {if(node.type!=='cost'&&node.type!=='benefit')throw new Error('Tiêu chí lá cần loại cost hoặc benefit');leaves.push(node);weights.push(parent*r.weights[i])}
  });
 };
 visit(criteria,matrix,1,'root',0);
 return {leaves,weights,treeConsistency,consistent:treeConsistency.every(x=>x.consistent)};
}

export function rankAlternatives(weights:number[],alternatives:Alternative[],types:Direction[]) {
 if(!alternatives.length||weights.length!==types.length||weights.some(w=>!Number.isFinite(w)||w<0)||Math.abs(weights.reduce((a,b)=>a+b,0)-1)>1e-7)throw new Error('Trọng số hoặc danh sách NCC không hợp lệ');
 if(new Set(alternatives.map(a=>a.supplierId)).size!==alternatives.length)throw new Error('NCC không được lặp');
 for(const a of alternatives)if(a.values.length!==weights.length||a.values.some(x=>!Number.isFinite(x)||x<=0))throw new Error('Điểm tiêu chí phải là số dương hữu hạn');
 // For measured ratio matrices the principal eigenvector is proportional to
 // the metric (or its inverse for costs), without rounding measurements.
 const local=types.map((type,j)=>normalize(alternatives.map(a=>type==='cost'?1/a.values[j]:a.values[j])));
 return alternatives.map((a,i)=>({supplierId:a.supplierId,supplierName:a.supplierName,localScores:local.map(v=>v[i]),score:weights.reduce((s,w,j)=>s+w*local[j][i],0)})).sort((a,b)=>b.score-a.score||a.supplierId.localeCompare(b.supplierId));
}

export function monteCarlo(weights:number[],alternatives:Alternative[],types:Direction[],iterations=1000,seed=42,uncertainty=.15) {
 if(!Number.isInteger(iterations)||iterations<100||iterations>5000||!Number.isInteger(seed)||!Number.isFinite(uncertainty)||uncertainty<0||uncertainty>1)throw new Error('Cấu hình Monte Carlo không hợp lệ');
 rankAlternatives(weights,alternatives,types);
 let state=seed>>>0;const random=()=>{state+=0x6D2B79F5;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296};
 const factor=()=>Math.exp((random()*2-1)*uncertainty),wins=new Map<string,number>(),means=new Map<string,number>();
 for(let i=0;i<iterations;i++) {
  const w=normalize(weights.map(x=>x*factor())),a=alternatives.map(x=>({...x,values:x.values.map(v=>v*factor())})),r=rankAlternatives(w,a,types);
  const tied=r.filter(v=>Math.abs(v.score-r[0].score)<1e-12);for(const winner of tied)wins.set(winner.supplierId,(wins.get(winner.supplierId)||0)+1/tied.length);
  for(const x of r)means.set(x.supplierId,(means.get(x.supplierId)||0)+x.score/iterations);
 }
 return {iterations,seed,uncertainty,distribution:'log-uniform multiplicative noise',winProbabilities:alternatives.map(a=>({supplierId:a.supplierId,probability:(wins.get(a.supplierId)||0)/iterations})),meanScores:alternatives.map(a=>({supplierId:a.supplierId,score:means.get(a.supplierId)||0}))};
}

export function sensitivity(weights:number[],alternatives:Alternative[],types:Direction[],ids:string[]) {
 if(weights.length!==ids.length||weights.length<2)throw new Error('Độ nhạy cần ít nhất hai tiêu chí');
 return weights.flatMap((_,i)=>Array.from({length:11},(_,step)=>{
  const weight=step/10,rest=1-weights[i],w=weights.map((x,j)=>j===i?weight:rest>1e-12?x*(1-weight)/rest:(1-weight)/(weights.length-1));
  return {criterionId:ids[i],weight,weights:w,ranking:rankAlternatives(w,alternatives,types)};
 }));
}
