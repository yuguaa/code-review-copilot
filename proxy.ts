import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  AUTH_COOKIE_NAME,
  getClientIp,
  isAuthConfigured,
  isClientIpAllowed,
  isIpWhitelistEnabled,
  verifyAuthSession,
} from "@/lib/auth";

const PUBLIC_API_PREFIXES = [
  "/api/webhook/gitlab",
  "/api/code-graph/refresh-scheduled",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isExternalCallbackPath(pathname)) {
    return NextResponse.next();
  }

  if (!isClientIpAllowed(request.headers)) {
    const clientIp = getClientIp(request.headers) || "unknown";
    const message = isIpWhitelistEnabled()
      ? `当前 IP 不在访问白名单内：${clientIp}`
      : "当前 IP 不允许访问";
    return createForbiddenResponse(request, message);
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (!isAuthConfigured()) {
    return createUnauthorizedResponse(request, "认证环境变量未完整配置");
  }

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;

  return verifyAuthSession(token).then((isAuthenticated) => {
    if (isAuthenticated) {
      return NextResponse.next();
    }

    return createUnauthorizedResponse(request, "未登录");
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};

function isPublicPath(pathname: string): boolean {
  if (pathname === "/login") return true;
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return true;
  return false;
}

function isExternalCallbackPath(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function createUnauthorizedResponse(request: NextRequest, message: string) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: message }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);

  return NextResponse.redirect(loginUrl);
}

function createForbiddenResponse(request: NextRequest, message: string) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: message }, { status: 403 });
  }

  return new NextResponse(message, {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
