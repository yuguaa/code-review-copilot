const allowedProtocols = new Set(["http:", "https:"]);

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function matchesDomain(hostname: string, scopeDomain: string): boolean {
  const pattern = normalizeHostname(scopeDomain);
  if (!pattern || pattern.includes("/") || pattern.includes("\\")) return false;

  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2);
    if (!suffix || suffix.includes("*")) return false;
    return hostname !== suffix && hostname.endsWith(`.${suffix}`);
  }

  if (pattern.includes("*")) return false;
  return hostname === pattern;
}

/**
 * 校验目标地址处于授权域名范围内。
 * 通配符只接受开头的 `*.`，并且必须匹配至少一个子域。
 */
export function assertUrlInScope(input: string | URL, scopeDomains: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(input instanceof URL ? input.href : input);
  } catch {
    throw new Error("URL 格式无效");
  }

  if (!allowedProtocols.has(url.protocol)) {
    throw new Error("URL 必须使用 http 或 https 协议");
  }
  if (url.username || url.password) {
    throw new Error("URL 不能包含用户名或密码");
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname || !scopeDomains.some((domain) => matchesDomain(hostname, domain))) {
    throw new Error(`URL 不在授权范围内：${url.origin}`);
  }
  return url;
}
