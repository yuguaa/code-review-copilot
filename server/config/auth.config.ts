const AUTH_ENV_KEYS = [
  'APP_AUTH_USERNAME',
  'APP_AUTH_SECRET',
  'APP_AUTH_SESSION_SECRET',
] as const;

export type AuthEnvKey = (typeof AUTH_ENV_KEYS)[number];

export type AuthConfig = {
  allowedClientIps: string[];
  sessionSecret: string;
  secret: string;
  username: string;
};

export function getMissingAuthEnv(): AuthEnvKey[] {
  return AUTH_ENV_KEYS.filter((key) => !process.env[key]?.trim());
}

export function getAuthConfig(): AuthConfig | null {
  const username = process.env.APP_AUTH_USERNAME?.trim();
  const secret = process.env.APP_AUTH_SECRET?.trim();
  const sessionSecret = process.env.APP_AUTH_SESSION_SECRET?.trim();

  if (!username || !secret || !sessionSecret) {
    return null;
  }

  return {
    allowedClientIps: normalizeIpList(process.env.APP_AUTH_IP_WHITELIST),
    sessionSecret,
    secret,
    username,
  };
}

export function getAllowedClientIps(): string[] {
  return getAuthConfig()?.allowedClientIps ?? normalizeIpList(process.env.APP_AUTH_IP_WHITELIST);
}

function normalizeIpList(value: string | undefined): string[] {
  if (!value?.trim()) return [];

  const ips = value
    .split(',')
    .map((item) => normalizeIp(item))
    .filter(Boolean);

  return Array.from(new Set(ips));
}

export function normalizeIp(value: string): string {
  const trimmedValue = value.trim();
  if (!trimmedValue) return '';

  const withoutPort = stripPort(trimmedValue);
  if (withoutPort.startsWith('::ffff:')) {
    return withoutPort.slice('::ffff:'.length);
  }

  return withoutPort;
}

function stripPort(value: string): string {
  if (value.startsWith('[')) {
    const endIndex = value.indexOf(']');
    return endIndex >= 0 ? value.slice(1, endIndex) : value;
  }

  const colonCount = value.split(':').length - 1;
  if (colonCount === 1) {
    return value.split(':')[0];
  }

  return value;
}
