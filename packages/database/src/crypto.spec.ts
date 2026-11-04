import { describe, expect, it } from 'vitest';
import { decodeEncryptionKey, emailHmac, encryptField } from './crypto';

const key = Buffer.alloc(32, 7);

describe('field encryption', () => {
  it('rejects a key that is not 32 bytes', () => {
    expect(() => decodeEncryptionKey(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
  });

  it('stores ciphertext that does not contain the plaintext email', () => {
    const email = 'person@example.com';
    const encrypted = encryptField(email, key);
    expect(encrypted.subarray(1 + 12 + 16).toString('utf8')).not.toContain(email);
    expect(encrypted[0]).toBe(1);
  });

  it('produces a stable hmac', () => {
    expect(emailHmac('Person@Example.com', key)).toBe(emailHmac('person@example.com', key));
  });
});
