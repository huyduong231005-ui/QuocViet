// Builds a throwaway real-mode database on the test cluster for a QA pass:
// migrated, with a runtime role, empty of business data. Writes the instance
// environment to a local file; prints no secret.
//   node scripts/with-test-cluster.cjs ../../scripts/qa/setup.ts
// The fixed QA administrator password below protects nothing: the database is
// disposable and holds only what the checks create.
import {randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Client} from 'pg';
import {Database} from '../../apps/api/src/db';
import {provisionRoles,runtimeUrl} from '../../apps/api/src/database/roles';

(async()=>{
 const adminUrl=process.env.TEST_DATABASE_URL!,name='quocviet_qa',target=new URL(adminUrl);target.pathname=`/${name}`;
 const admin=new Client({connectionString:adminUrl});await admin.connect();
 try{await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);await admin.query(`CREATE DATABASE ${name}`)}finally{await admin.end()}
 await Database.migrate(target.toString());
 const password=await provisionRoles(target.toString(),{owner:'qa_owner',app:'qa_app'},true);
 writeFileSync(process.argv[2]??resolve(__dirname,'../../.data/qa.env.json'),JSON.stringify({DATABASE_URL:runtimeUrl(target.toString(),'qa_app',password!),PORT:'3100',HOST:'127.0.0.1',DEMO_MODE:'false',AGENT_ENABLED:'false',JWT_SECRET:randomBytes(32).toString('hex'),ADMIN_EMAIL:'admin@qa.local',ADMIN_PASSWORD:'QaAdmin2026',MIGRATION_DATABASE_URL:''}));
 console.log('qa database ready');
})().catch(error=>{console.error('qa setup failed:',error.message);process.exit(1)});
