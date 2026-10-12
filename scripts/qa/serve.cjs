// Runs the built API against the QA database on port 3100 until stopped.
//   node scripts/qa/serve.cjs
const {resolve} = require('node:path');
Object.assign(process.env, JSON.parse(require('node:fs').readFileSync(process.argv[2] || resolve(__dirname, '../../.data/qa.env.json'), 'utf8')));
require('../../apps/api/dist/main.js');
