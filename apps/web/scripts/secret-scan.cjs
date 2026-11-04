const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const forbidden = [
  'DATABASE_URL',
  'REDIS_URL',
  'INTERNAL_JOB_TOKEN',
  'SALESOS_APP_PASSWORD',
  'DATA_ENCRYPTION_KEY',
  'POSTGRES_PASSWORD',
];
const allowedSuffixes = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.css']);
const hits = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // e2e is Playwright running in Node. It is not part of the browser bundle.
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'scripts' || entry.name === 'e2e') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (allowedSuffixes.has(path.extname(entry.name))) {
      const source = fs.readFileSync(full, 'utf8');
      for (const name of forbidden) {
        if (source.includes(name)) hits.push(`${path.relative(root, full)} contains ${name}`);
      }
    }
  }
}

walk(root);
if (hits.length) {
  for (const hit of hits) console.error(hit);
  process.exit(1);
}
console.log('PASS web source does not reference server secrets');
