import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [source, destination, publicUrl] = process.argv.slice(2);
if (!source || !destination || !publicUrl) throw new Error("需要指定来源、运行配置路径和公开地址");
const environment = JSON.parse(await readFile(source, "utf8"));
if (!Array.isArray(environment) || environment.some((value) => typeof value !== "string")) throw new Error("容器环境数据无效");
const valueOf = (key) => environment.find((entry) => entry.startsWith(`${key}=`))?.slice(key.length + 1);
const database = new URL(valueOf("DATABASE_URL"));
if (database.username !== "code_review" || database.pathname !== "/code_review_copilot") throw new Error("旧数据库与部署目标不一致");
const password = decodeURIComponent(database.password);
if (!/^[A-Za-z0-9_-]+$/.test(password)) throw new Error("数据库密码需要使用 URL 安全字符");
const url = new URL(publicUrl);
if (!["http:", "https:"].includes(url.protocol) || !url.port) throw new Error("公开地址必须包含 HTTP 协议与端口");
const values = {
  APP_AUTH_USERNAME: valueOf("APP_AUTH_USERNAME"),
  APP_AUTH_SECRET: valueOf("APP_AUTH_SECRET"),
  APP_AUTH_SESSION_SECRET: valueOf("APP_AUTH_SESSION_SECRET") || randomBytes(32).toString("hex"),
  POSTGRES_PASSWORD: password,
  APP_PORT: url.port,
  APP_PUBLIC_URL: url.origin,
};
if (!values.APP_AUTH_USERNAME || !values.APP_AUTH_SECRET) throw new Error("旧服务缺少登录凭证，停止部署准备");
await writeFile(destination, Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n", { mode: 0o600 });
console.info("部署运行配置已生成，原账号与密码已保留。");
