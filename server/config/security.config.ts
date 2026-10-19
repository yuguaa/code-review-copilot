import path from "node:path";

export type SecurityConfig = {
  artifactsRoot: string;
  skillsRoot: string;
  agentBrowserBin: string;
  actionPolicyPath: string;
  zapApiUrl?: string;
};

const zapApiUrl = process.env.ZAP_API_URL?.trim();

export const securityConfig: SecurityConfig = {
  artifactsRoot: path.resolve(process.env.SECURITY_ARTIFACTS_ROOT ?? "./.security-artifacts"),
  skillsRoot: path.resolve(process.env.SECURITY_SKILLS_ROOT ?? "./security-skills"),
  agentBrowserBin: path.resolve(process.env.AGENT_BROWSER_BIN ?? "./node_modules/.bin/agent-browser"),
  actionPolicyPath: path.resolve(process.env.SECURITY_ACTION_POLICY ?? "./security-skills/hack/action-policy.json"),
  ...(zapApiUrl ? { zapApiUrl } : {}),
};
