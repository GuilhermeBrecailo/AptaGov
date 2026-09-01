import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, encodedSalt, encodedKey] = encoded.split('$');
  if (algorithm !== 'scrypt' || !encodedSalt || !encodedKey) return false;
  const salt = Buffer.from(encodedSalt, 'base64url');
  const expected = Buffer.from(encodedKey, 'base64url');
  const actual = await deriveKey(password, salt);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}
