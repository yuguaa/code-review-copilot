import { constantTimeEqual } from "@/lib/auth";

type MonitoringRequest = {
  headers: Headers;
  nextUrl: {
    searchParams: URLSearchParams;
  };
};

function readBearerToken(request: MonitoringRequest): string {
  const authorization = request.headers.get("authorization") || "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }
  return request.nextUrl.searchParams.get("token")?.trim() || "";
}

export function isMonitoringRequestAuthorized(request: MonitoringRequest): boolean {
  const expectedToken = process.env.MONITORING_TOKEN?.trim();
  if (!expectedToken) return false;

  const receivedToken = readBearerToken(request);
  return Boolean(receivedToken) && constantTimeEqual(receivedToken, expectedToken);
}
