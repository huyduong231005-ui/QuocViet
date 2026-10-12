// Runs a tsx command in apps/api with TEST_DATABASE_URL pointing at the local
// disposable PostgreSQL cluster, for example:
//   node scripts/with-test-cluster.cjs --test test/database-native.test.ts
//   node scripts/with-test-cluster.cjs src/database/cli.ts migrate
// The password is read into memory and handed to the child through its
// environment; it never appears on a command line or in output.
const {readFileSync} = require('node:fs');
const {spawnSync} = require('node:child_process');
const {resolve} = require('node:path');

const root = resolve(__dirname, '..');
const passwordFile = process.env.TEST_PG_PASSWORD_FILE || resolve(root, '.data/postgres-setup-tests/test-password.txt');
const port = process.env.TEST_PG_PORT || '55439';
// encodeURIComponent, not URL.password: the URL setter leaves '%' and other
// characters raw, and the driver would then decode them as escapes.
const user = encodeURIComponent(process.env.TEST_PG_USER || 'postgres');
const password = encodeURIComponent(readFileSync(passwordFile, 'utf8'));
const url = `postgresql://${user}:${password}@127.0.0.1:${port}/postgres`;

const result = spawnSync(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), ...process.argv.slice(2)], {
  cwd: resolve(root, 'apps/api'),
  env: {...process.env, TEST_DATABASE_URL: url},
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
