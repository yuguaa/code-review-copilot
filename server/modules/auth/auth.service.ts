import { getAllowedClientIps, getAuthConfig, getMissingAuthEnv, normalizeIp } from '../../config/auth.config';

export const AUTH_COOKIE_NAME = "code_review_copilot_session";
export const AUTH_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

type SessionPayload = {
  username: string;
  exp: number;
  iat: number;
};

const encoder = new TextEncoder();

export function isAuthConfigured(): boolean {
  return getMissingAuthEnv().length === 0;
}

export function isIpWhitelistEnabled(): boolean {
  return getAllowedClientIps().length > 0;
}

export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for")?.split(",")[0];
  const realIp = headers.get("x-real-ip");

  return normalizeIp(forwardedFor || realIp || "");
}

export function isClientIpAllowed(headers: Headers): boolean {
  const allowedIps = getAllowedClientIps();
  if (allowedIps.length === 0) return true;

  const clientIp = getClientIp(headers);
  if (!clientIp) return false;

  return allowedIps.includes(clientIp);
}

export function shouldUseSecureAuthCookie(headers: Headers, protocol: string): boolean {
  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwardedProto) {
    return forwardedProto === "https";
  }

  return protocol === "https:";
}

export function verifyLoginCredential(username: string, secret: string): boolean {
  const config = getAuthConfig();
  if (!config) return false;

  return (
    constantTimeEqual(username.trim(), config.username) &&
    constantTimeEqual(secret, config.secret)
  );
}

export function createAuthSession(username: string): Promise<string> {
  const config = getAuthConfig();
  if (!config) {
    return Promise.reject(new Error("认证环境变量未完整配置"));
  }

  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    username,
    iat: now,
    exp: now + AUTH_SESSION_MAX_AGE_SECONDS,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));

  return signValue(encodedPayload, config.sessionSecret).then(
    (signature) => `${encodedPayload}.${signature}`,
  );
}

export function verifyAuthSession(token: string | undefined): Promise<boolean> {
  const config = getAuthConfig();
  if (!config || !token) return Promise.resolve(false);

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return Promise.resolve(false);

  return signValue(encodedPayload, config.sessionSecret)
    .then((expectedSignature) => {
      if (!constantTimeEqual(signature, expectedSignature)) return false;

      const payload = parseSessionPayload(encodedPayload);
      if (!payload) return false;
      if (!constantTimeEqual(payload.username, config.username)) return false;

      return payload.exp > Math.floor(Date.now() / 1000);
    })
    .catch(() => false);
}

function parseSessionPayload(encodedPayload: string): SessionPayload | null {
  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (
      typeof payload?.username !== "string" ||
      typeof payload?.exp !== "number" ||
      typeof payload?.iat !== "number"
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function signValue(value: string, secret: string): Promise<string> {
  return crypto.subtle
    .importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    )
    .then((key) => crypto.subtle.sign("HMAC", key, encoder.encode(value)))
    .then((signature) => base64UrlEncodeBytes(new Uint8Array(signature)));
}

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return diff === 0;
}

function base64UrlEncode(value: string): string {
  return base64UrlEncodeBytes(encoder.encode(value));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecode(value: string): string {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  return new TextDecoder().decode(bytes);
}
