import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  AUTH_SESSION_MAX_AGE_SECONDS,
  createAuthSession,
  getMissingAuthEnv,
  shouldUseSecureAuthCookie,
  verifyLoginCredential,
} from "@/lib/auth";

export const runtime = "nodejs";

type LoginBody = {
  username?: unknown;
  secret?: unknown;
};

export function POST(request: NextRequest) {
  const missingEnv = getMissingAuthEnv();
  if (missingEnv.length > 0) {
    return NextResponse.json(
      { error: `认证环境变量未完整配置：${missingEnv.join(", ")}` },
      { status: 500 },
    );
  }

  return request
    .json()
    .then((body: LoginBody): NextResponse | Promise<NextResponse> => {
      const username = typeof body.username === "string" ? body.username : "";
      const secret = typeof body.secret === "string" ? body.secret : "";

      if (!verifyLoginCredential(username, secret)) {
        return NextResponse.json({ error: "账号或密钥不正确" }, { status: 401 });
      }

      return createAuthSession(username.trim()).then((token) => {
        const response = NextResponse.json({ success: true });
        response.cookies.set({
          name: AUTH_COOKIE_NAME,
          value: token,
          path: "/",
          httpOnly: true,
          sameSite: "lax",
          secure: shouldUseSecureAuthCookie(request.headers, request.nextUrl.protocol),
          maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
        });

        return response;
      });
    })
    .catch(() => NextResponse.json({ error: "登录请求无效" }, { status: 400 }));
}
