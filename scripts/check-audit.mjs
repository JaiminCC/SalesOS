import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const exceptions = JSON.parse(readFileSync(new URL('../docs/security/dependency-exceptions.json', import.meta.url), 'utf8'));
const allowed = new Set(exceptions.advisories.map((advisory) => advisory.id));

let raw = '';
try {
  raw = execSync('pnpm audit --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (error) {
  raw = error.stdout?.toString() ?? '';
  if (!raw) {
    process.stderr.write(`${error.stderr?.toString() ?? error.message}\n`);
    process.exit(1);
  }
}

const report = JSON.parse(raw);
const found = new Set();
const advisories = report.advisories ?? {};
for (const advisory of Object.values(advisories)) {
  if (advisory && typeof advisory === 'object' && 'github_advisory_id' in advisory && advisory.github_advisory_id) {
    found.add(advisory.github_advisory_id);
  }
}
if (Array.isArray(report.vulnerabilities)) {
  for (const vulnerability of report.vulnerabilities) {
    if (vulnerability?.github_advisory_id) found.add(vulnerability.github_advisory_id);
  }
}

const unknown = [...found].filter((id) => !allowed.has(id));
if (unknown.length) {
  process.stderr.write(`Unreviewed advisories: ${unknown.join(', ')}\n`);
  process.exit(1);
}
process.stdout.write(`Audit advisories are covered by the exception list (${found.size}).\n`);
