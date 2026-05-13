export const TOKEN_CIPHERTEXT_PREFIX = 'enc:v1:';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function requireEncryptionKey(encryptionKey: string): string {
  const key = encryptionKey?.trim();
  if (!key) {
    throw new Error('ENCRYPTION_KEY is required for OAuth token encryption');
  }
  return key;
}

async function importAesKey(encryptionKey: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    textEncoder.encode(requireEncryptionKey(encryptionKey))
  );
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    Math.ceil(value.length / 4) * 4,
    '='
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function isEncryptedToken(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(TOKEN_CIPHERTEXT_PREFIX);
}

export async function encryptToken(token: string | null | undefined, encryptionKey: string): Promise<string> {
  if (!token) return '';
  if (isEncryptedToken(token)) return token;

  const key = await importAesKey(encryptionKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, textEncoder.encode(token))
  );

  return `${TOKEN_CIPHERTEXT_PREFIX}${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
}

export async function decryptToken(storedToken: string | null | undefined, encryptionKey: string): Promise<string> {
  if (!storedToken) return '';
  if (!isEncryptedToken(storedToken)) return storedToken;

  const payload = storedToken.slice(TOKEN_CIPHERTEXT_PREFIX.length);
  const [ivPart, ciphertextPart] = payload.split('.');
  if (!ivPart || !ciphertextPart) {
    throw new Error('Invalid encrypted OAuth token');
  }

  try {
    const key = await importAesKey(encryptionKey);
    const iv = fromBase64Url(ivPart);
    const ciphertext = fromBase64Url(ciphertextPart);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return textDecoder.decode(plaintext);
  } catch {
    throw new Error('Invalid encrypted OAuth token');
  }
}
