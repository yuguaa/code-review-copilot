const allowedProtocols = new Set(["http:", "https:"]);

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function matchesDomain(hostname: string, scopeDomain: string): boolean {
  const pattern = normalizeHostname(scopeDomain);
  if (!pattern || pattern.includes("/") || pattern.includes("\\") || pattern.includes("*")) return false;
  return hostname === pattern;
}

function scopedUrl(url: URL, scopeDomains: readonly string[]): boolean {
  if (!allowedProtocols.has(url.protocol) || url.username || url.password) return false;
  const hostname = normalizeHostname(url.hostname);
  return Boolean(hostname) && scopeDomains.some((domain) => matchesDomain(hostname, domain));
}

function parseUrl(input: string | URL): URL {
  const href = input instanceof URL ? input.href : input;
  if (!URL.canParse(href)) throw new Error("URL 格式无效");
  return new URL(href);
}

export function isUrlInScope(input: string | URL, scopeDomains: readonly string[]): boolean {
  const href = input instanceof URL ? input.href : input;
  if (!URL.canParse(href)) return false;
  return scopedUrl(new URL(href), scopeDomains);
}

/**
 * 校验目标地址处于授权域名范围内。
 * 授权范围使用完整域名，避免浏览器层通配符扩大实际请求范围。
 */
export function assertUrlInScope(input: string | URL, scopeDomains: readonly string[]): URL {
  const url = parseUrl(input);

  if (!allowedProtocols.has(url.protocol)) {
    throw new Error("URL 必须使用 http 或 https 协议");
  }
  if (url.username || url.password) {
    throw new Error("URL 不能包含用户名或密码");
  }

  if (!scopedUrl(url, scopeDomains)) {
    throw new Error(`URL 不在授权范围内：${url.origin}`);
  }
  return url;
}
