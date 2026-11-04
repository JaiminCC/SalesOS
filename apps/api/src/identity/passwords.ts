import argon2 from 'argon2';

const options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

let dummyHashPromise: Promise<string> | undefined;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, options);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function dummyPasswordHash(): Promise<string> {
  dummyHashPromise ??= argon2.hash('salesos-timing-padding', options);
  return dummyHashPromise;
}
