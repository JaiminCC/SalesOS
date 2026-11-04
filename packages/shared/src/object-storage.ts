import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const keyPattern = /^tenant\/[0-9a-f-]{36}\/knowledge\/[0-9a-f-]{36}$/i;

export function knowledgeObjectKey(tenantId: string, documentId: string): string {
  const key = `tenant/${tenantId}/knowledge/${documentId}`;
  if (!keyPattern.test(key)) throw new Error('invalid object key');
  return key;
}

export function resolveObjectPath(root: string, key: string): string {
  if (!root || !keyPattern.test(key) || key.includes('..') || key.includes('\\') || key.includes('\0')) {
    throw new Error('invalid object key');
  }
  const base = resolve(root);
  const full = resolve(base, key);
  if (full !== base && !full.startsWith(`${base}${sep}`)) throw new Error('invalid object key');
  return full;
}

export function storageRootFromEnv(env: NodeJS.ProcessEnv, cwd = process.cwd()): string {
  if (env.SALESOS_STORAGE_ROOT) return resolve(env.SALESOS_STORAGE_ROOT);
  return resolve(cwd, cwd.endsWith('/apps/api') || cwd.endsWith('/apps/worker') ? '../../data/objects' : 'data/objects');
}

export async function writePrivateObject(root: string, key: string, bytes: Buffer): Promise<void> {
  const full = resolveObjectPath(root, key);
  await mkdir(resolve(full, '..'), { recursive: true });
  await writeFile(full, bytes);
}

export async function readPrivateObject(root: string, key: string): Promise<Buffer> {
  return readFile(resolveObjectPath(root, key));
}

export async function deletePrivateObject(root: string, key: string): Promise<void> {
  await rm(resolveObjectPath(root, key), { force: true });
}
