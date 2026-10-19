import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const algorithm = "aes-256-gcm";
const version = "v1";
const keySalt = "code-review-copilot:security-identity";
const additionalData = Buffer.from("security-identity:v1");
let cachedKey: { secret: string; key: Buffer } | null = null;

function encryptionKey(): Buffer {
  const secret = process.env.APP_AUTH_SESSION_SECRET;
  if (!secret?.trim()) throw new Error("APP_AUTH_SESSION_SECRET 未配置");
  if (cachedKey?.secret === secret) return cachedKey.key;
  const key = scryptSync(secret, keySalt, 32);
  cachedKey = { secret, key };
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, encryptionKey(), iv);
  cipher.setAAD(additionalData);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [version, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(ciphertext: string): string {
  const [storedVersion, ivValue, tagValue, encryptedValue, ...rest] = ciphertext.split(".");
  if (storedVersion !== version || !ivValue || !tagValue || !encryptedValue || rest.length) {
    throw new Error("身份凭据密文格式无效");
  }

  const decipher = createDecipheriv(algorithm, encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAAD(additionalData);
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}
