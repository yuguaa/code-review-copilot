import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, shouldUseSecureAuthCookie } from "@/lib/auth";

export function POST(request: NextRequest) {
  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: "",
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureAuthCookie(request.headers, request.nextUrl.protocol),
    maxAge: 0,
  });

  return response;
}
