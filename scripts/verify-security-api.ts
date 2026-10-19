import "dotenv/config";

const baseUrl = (process.env.APP_PUBLIC_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const username = process.env.APP_AUTH_USERNAME;
const secret = process.env.APP_AUTH_SECRET;

if (!username || !secret) throw new Error("缺少 APP_AUTH_USERNAME 或 APP_AUTH_SECRET");

function request(path: string, init: RequestInit = {}, cookie?: string) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (cookie) headers.set("Cookie", cookie);
  return fetch(`${baseUrl}${path}`, { ...init, headers }).then((response) => {
    if (!response.ok) {
      return response.text().then((text) => {
        throw new Error(`${init.method ?? "GET"} ${path} 失败：${response.status} ${text}`);
      });
    }
    return response.status === 204 ? undefined : response.json();
  });
}

fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: baseUrl },
  body: JSON.stringify({ username, secret }),
}).then((response) => {
  if (!response.ok) return response.text().then((text) => { throw new Error(`登录失败：${response.status} ${text}`); });
  const cookie = response.headers.getSetCookie?.()[0]?.split(";")[0] ?? response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("登录没有返回会话 Cookie");

  const authorizedUntil = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  return request("/api/security/targets", {
    method: "POST",
    body: JSON.stringify({
      name: "平台安全测试验证目标",
      baseUrl: "http://127.0.0.1:8787",
      scopeDomains: ["127.0.0.1"],
      authorizationOwner: "平台管理员",
      authorizationReference: "LOCAL-VERIFICATION",
      authorizedUntil,
      scheduleEnabled: false,
      scheduleIntervalMinutes: 1440,
      isActive: true,
      maxDurationMinutes: 5,
    }),
  }, cookie).then((created) => {
    const target = (created as { target: { id: string } }).target;
    return request(`/api/security/targets/${target.id}/identities`, {
      method: "POST",
      body: JSON.stringify({
        name: "验证账号",
        role: "user",
        username: "security-verification",
        password: "security-verification-password",
        isActive: true,
      }),
    }, cookie).then((identityResponse) => {
      const serializedIdentity = JSON.stringify(identityResponse);
      if (serializedIdentity.includes("security-verification-password") || serializedIdentity.includes("secretCiphertext")) {
        throw new Error("身份接口泄露了密码或密文");
      }
      return request("/api/security/tickets", {
        method: "POST",
        body: JSON.stringify({ targetId: target.id }),
      }, cookie);
    }).then((ticketResponse) => {
      const ticket = (ticketResponse as { ticket: { id: string; status: string } }).ticket;
      if (ticket.status !== "queued") throw new Error(`新建工单状态错误：${ticket.status}`);
      console.log(JSON.stringify({ targetId: target.id, ticketId: ticket.id }));
    });
  });
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
