const AUTH_ENV_KEYS = ['APP_AUTH_USERNAME', 'APP_AUTH_SECRET', 'APP_AUTH_SESSION_SECRET'] as const;

export function getMissingAuthEnv(): AuthEnvKey[] {
  return AUTH_ENV_KEYS.filter((key) => !process.env[key]?.trim());
}

export function getAuthConfig(): AuthConfig | null {
  const username = process.env.APP_AUTH_USERNAME?.trim();
  const secret = process.env.APP_AUTH_SECRET;
  const sessionSecret = process.env.APP_AUTH_SESSION_SECRET;
  if (!username || !secret?.trim() || !sessionSecret?.trim()) return null;
  return { username, secret, sessionSecret };
}

export type AuthEnvKey = (typeof AUTH_ENV_KEYS)[number];

export type AuthConfig = { username: string; secret: string; sessionSecret: string };
