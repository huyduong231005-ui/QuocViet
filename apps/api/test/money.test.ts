import {test} from 'node:test';import assert from 'node:assert/strict';import {totalMoney} from '../src/money';
test('VND totals reject unsafe integers rather than silently round the price',()=>assert.throws(()=>totalMoney(9999999,9999999999,0),/tiền vượt/));
test('VAT totals use exact rational arithmetic and round once to VND',()=>{assert.equal(totalMoney(3,105,8.25),341);assert.equal(totalMoney(2,10000,8),21600);assert.throws(()=>totalMoney(1,1.1,0));assert.throws(()=>totalMoney(1,10,8.123))});
