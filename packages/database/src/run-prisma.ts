import { spawnSync } from 'node:child_process';
import './load-env';

const result = spawnSync('prisma', process.argv.slice(2), {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}
process.exit(result.status ?? 1);
