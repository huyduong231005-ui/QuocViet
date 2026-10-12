import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eigenWeights, rankAlternatives, monteCarlo, flattenCriteria, sensitivity } from '../src/ahp';

const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-7, `${a} != ${b}`);
test('known consistent three criterion ratios produce 0.6/0.3/0.1 and CR zero',()=>{
 const r=eigenWeights([[1,2,6],[.5,1,3],[1/6,1/3,1]]); r.weights.forEach((w,i)=>near(w,[.6,.3,.1][i])); near(r.cr,0);near(r.lambdaMax,3);
});
test('equal four criterion matrix gives equal weights',()=>{const r=eigenWeights(Array.from({length:4},()=>[1,1,1,1]));r.weights.forEach(w=>near(w,.25));near(r.cr,0)});
test('two criterion 3:1 gives 0.75/0.25 and one criterion is one',()=>{assert.deepEqual(eigenWeights([[1]]).weights,[1]);const r=eigenWeights([[1,3],[1/3,1]]);near(r.weights[0],.75);near(r.cr,0)});
test('inconsistent reciprocal judgment is flagged',()=>assert.ok(eigenWeights([[1,9,1/9],[1/9,1,9],[9,1/9,1]]).cr>.1));
test('invalid matrices cannot enter decision logic',()=>{for(const m of [[],[[1,2],[2,1]],[[1,NaN],[.5,1]],[[2]],[[1,0],[Infinity,1]]])assert.throws(()=>eigenWeights(m))});
const alternatives=[{supplierId:'a',supplierName:'A',values:[100,90]},{supplierId:'b',supplierName:'B',values:[200,80]}];
test('cost criteria invert price and local/global priorities sum to one',()=>{const r=rankAlternatives([.7,.3],alternatives,['cost','benefit']);assert.equal(r[0].supplierId,'a');near(r.reduce((s,v)=>s+v.score,0),1);near(r[0].localScores[0],2/3)});
test('seeded Monte Carlo is repeatable and probabilities sum to one',()=>{const a=monteCarlo([.7,.3],alternatives,['cost','benefit'],200,42,.2);assert.deepEqual(a,monteCarlo([.7,.3],alternatives,['cost','benefit'],200,42,.2));near(a.winProbabilities.reduce((s,x)=>s+x.probability,0),1);assert.equal(a.iterations,200)});
test('hierarchy propagates local group weights into leaves',()=>{const r=flattenCriteria([{id:'cost',name:'Cost',children:[{id:'price',name:'Price',type:'cost'},{id:'delivery',name:'Days',type:'cost'}],matrix:[[1,3],[1/3,1]]},{id:'quality',name:'Quality',type:'benefit'}],[[1,1],[1,1]]);near(r.weights[0],.375);near(r.weights[1],.125);near(r.weights[2],.5);assert.equal(r.leaves.length,3)});
test('sensitivity changes one weight while preserving total',()=>{const r=sensitivity([.7,.3],alternatives,['cost','benefit'],['price','quality']);assert.equal(r.length,22);assert.ok(r.every(s=>Math.abs(s.weights.reduce((a,b)=>a+b,0)-1)<1e-9))});
