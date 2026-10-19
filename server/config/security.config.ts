import path from "node:path";

export type SecurityConfig = {
  artifactsRoot: string;
  skillsRoot: string;
  skillNames: string[];
  skillVersion: string;
  agentBrowserBin: string;
  actionPolicyPath: string;
  zapApiUrl?: string;
};

const zapApiUrl = process.env.ZAP_API_URL?.trim();
const skillNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function parseSecuritySkillNames(value: string | undefined): string[] {
  const names = (value ?? "hack").split(",").map((name) => name.trim()).filter(Boolean);
  if (!names.length) throw new Error("至少需要配置一个安全测试 Skill");
  for (const name of names) {
    if (!skillNamePattern.test(name)) throw new Error(`安全测试 Skill 名称无效：${name}`);
  }
  return [...new Set(names)];
}

const skillNames = parseSecuritySkillNames(process.env.SECURITY_SKILLS);

export const securityConfig: SecurityConfig = {
  artifactsRoot: path.resolve(process.env.SECURITY_ARTIFACTS_ROOT ?? "./.security-artifacts"),
  skillsRoot: path.resolve(process.env.SECURITY_SKILLS_ROOT ?? "./security-skills"),
  skillNames,
  skillVersion: process.env.SECURITY_SKILL_VERSION?.trim() || skillNames.join(","),
  agentBrowserBin: path.resolve(process.env.AGENT_BROWSER_BIN ?? "./node_modules/.bin/agent-browser"),
  actionPolicyPath: path.resolve(process.env.SECURITY_ACTION_POLICY ?? "./security-skills/hack/action-policy.json"),
  ...(zapApiUrl ? { zapApiUrl } : {}),
};
