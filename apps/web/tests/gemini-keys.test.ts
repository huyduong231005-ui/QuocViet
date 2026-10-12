import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGeminiKeys} from '../src/gemini-keys.ts';

test('web key box accepts pasted labels, quotes and multiple keys without echoing them',()=>{
 assert.deepEqual(parseGeminiKeys(['"GEMINI_API_KEYS=demo.key=1, AQ_test+2"']),['demo.key=1','AQ_test+2']);
 assert.deepEqual(parseGeminiKeys(['demo.key=1','AQ_test+2','demo.key=1']),['demo.key=1','AQ_test+2']);
 assert.throws(()=>parseGeminiKeys(['demo key']),/không hợp lệ/);
 assert.throws(()=>parseGeminiKeys(['']),/1 đến 20/);
});
