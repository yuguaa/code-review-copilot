import { z } from "zod";

export const ocrResultSchema = z.object({
  status: z.enum(["complete", "partial", "failed", "skipped", "completed_with_warnings", "completed_with_errors"]),
  comments: z.array(z.object({
    path: z.string().min(1),
    content: z.string().min(1),
    start_line: z.number().int().nonnegative(),
    end_line: z.number().int().nonnegative(),
    existing_code: z.string().optional(),
    suggestion_code: z.string().optional(),
    category: z.string().optional(),
    severity: z.string().optional(),
  }).passthrough()),
  warnings: z.array(z.unknown()).optional(),
  summary: z.record(z.unknown()).optional(),
  message: z.string().optional(),
  session_id: z.string().optional(),
  trace_id: z.string().optional(),
}).passthrough();

const tokenUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative().optional().default(0),
}).passthrough();

export type OcrTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
};

export function parseOcrResult(stdout: string): OcrResult {
  return ocrResultSchema.parse(JSON.parse(stdout));
}

export function tokenUsageFromOcrResult(value: unknown): OcrTokenUsage | null {
  const result = ocrResultSchema.safeParse(value);
  if (!result.success || !result.data.summary) return null;
  const usage = tokenUsageSchema.safeParse(result.data.summary);
  if (!usage.success) return null;
  return {
    inputTokens: usage.data.input_tokens,
    outputTokens: usage.data.output_tokens,
    totalTokens: usage.data.total_tokens,
    cacheReadTokens: usage.data.cache_read_tokens,
  };
}

export function reviewStatus(result: OcrResult, exitCode: number | null): string {
  if (exitCode !== 0 || result.status === "failed") return "failed";
  if (result.status === "partial" || result.status === "completed_with_errors") return "partial";
  if (result.status === "skipped") return "skipped";
  return "completed";
}

function codeBlock(text: string): string {
  const fence = "`".repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length + 1)));
  return `${fence}\n${text}\n${fence}`;
}

export function renderOcrReport(result: OcrResult, range: { baseSha: string; headSha: string }): string {
  const lines = ["# 代码审查报告", "", `提交范围：${range.baseSha} → ${range.headSha}`, "", `引擎状态：${result.status}`, ""];
  if (result.message) lines.push(result.message, "");
  for (const [index, comment] of result.comments.entries()) {
    lines.push(`## ${index + 1}. ${comment.path}:${comment.start_line}`, "", comment.content, "");
    if (comment.category || comment.severity) lines.push(`类型：${comment.category ?? "未提供"} · 严重程度：${comment.severity ?? "未提供"}`, "");
    if (comment.existing_code) lines.push("原始代码：", codeBlock(comment.existing_code), "");
    if (comment.suggestion_code) lines.push("建议代码：", codeBlock(comment.suggestion_code), "");
  }
  if (!result.comments.length) lines.push(result.status === "skipped" ? "本次没有选中可审查文件。" : "本次已完成范围内没有生成审查意见。", "");
  if (result.warnings?.length) lines.push("## 覆盖情况与警告", "", ...result.warnings.map((warning) => `- ${typeof warning === "string" ? warning : JSON.stringify(warning)}`));
  return lines.join("\n");
}

export type OcrResult = z.infer<typeof ocrResultSchema>;
