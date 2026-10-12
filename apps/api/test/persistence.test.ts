import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../src/db';
import { Procurement } from '../src/procurement';

test('disk database retains a request and approval across reopening', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'procureiq-persistence-'));
  const path = join(directory, 'postgres');
  let db: Database | undefined;
  try {
    db = await Database.open(path);
    let service = new Procurement(db);
    await service.initialize();
    const request = await service.act('request', {id:'u-buyer',name:'Buyer',role:'buyer'}, {
      productId:'pro-paper', quantity:10, reason:'Persistence test',
    });
    const before = await service.bootstrap();
    const approval = before.approvals.find((item:any) => item.requestId === request.id);
    await db.close(); db = undefined;
    db = await Database.open(path);
    service = new Procurement(db); await service.initialize();
    const after = await service.bootstrap();
    assert.equal(after.requests.find((item:any) => item.id === request.id)?.reason, 'Persistence test');
    assert.equal(after.approvals.find((item:any) => item.id === approval.id)?.status, 'pending');
    assert.equal(await db.transaction(async repository => (await repository.list('users')).length), 5);
  } finally {
    if (db) await db.close();
    await rm(directory, {recursive:true,force:true});
  }
});
