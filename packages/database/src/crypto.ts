import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

export function decodeEncryptionKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) {
    throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes encoded as base64');
  }
  return key;
}

export function encryptField(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([1]), iv, tag, ciphertext]);
}

export function decryptField(payload: Buffer, key: Buffer): string {
  if (payload[0] !== 1 || payload.length < 30) throw new Error('ciphertext is not a SalesOS field');
  const iv = payload.subarray(1, 13);
  const tag = payload.subarray(13, 29);
  const data = payload.subarray(29);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function emailHmac(normalizedEmail: string, key: Buffer): string {
  return createHmac('sha256', key).update(normalizedEmail.trim().toLowerCase()).digest('hex');
}
