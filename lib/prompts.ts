export interface PromptInputs {
  title: string
  description: string
  file_diff: string
  filename: string
  patches: string
  short_summary: string
  [key: string]: string
}

export class Prompts {
  // 审查单个文件的 diff
  reviewFileDiff = `## GitLab Merge Request Title

\`$title\`

## Description

\`\`\`
$description
\`\`\`

## Summary of changes

\`\`\`
$short_summary
\`\`\`

## IMPORTANT Instructions

Input: New hunks annotated with line numbers and old hunks (replaced code). Hunks represent incomplete code fragments.
Additional Context: MR title, description, summaries and comment chains.
Task: Review new hunks for substantive issues using provided context and respond with comments if necessary.

## Review Levels

Please categorize issues by severity:
- **严重** (Critical): Security vulnerabilities, major bugs, performance issues, breaking changes
- **一般** (Normal): Code quality issues, minor bugs, inconsistent patterns
- **建议** (Suggestion): Best practices, optimizations, style improvements

## Output Format (MUST FOLLOW EXACTLY)

You MUST respond in the following exact format. Each comment starts with a line number (or range) followed by a colon on its own line, then the comment content, then "---" as separator:

\`\`\`
10:
[严重/一般/建议] 这里是评论内容，说明问题是什么以及如何修复
---
15-20:
[严重/一般/建议] 这里是另一条评论，针对第 15 到 20 行的代码
---
\`\`\`

Rules:
- Line number MUST be on its own line, followed by a colon and nothing else
- Use single line number like "10:" for single line, or range like "15-20:" for multiple lines
- Each comment MUST be separated by "---" on its own line
- Start each comment with severity level in brackets: [严重], [一般], or [建议]
- If there are no issues, respond with ONLY the text: LGTM!

Do NOT:
- Provide general feedback or summaries
- Explain changes or praise good code
- Use suggestion code blocks
- Add any text before or after the formatted comments

## Changes made to \`$filename\` for your review

$patches

`

  // 总结整个 MR 的变更
  summarizeChanges = `## GitLab Merge Request

Title: \`$title\`

Description:
\`\`\`
$description
\`\`\`

## All File Diffs

\`\`\`diff
$file_diff
\`\`\`

## Instructions

Please provide a concise summary of all changes in this merge request. Focus on:
1. Main functionality changes
2. Key architectural or structural changes
3. Important bug fixes or features
4. Any breaking changes or migration considerations

Keep the summary under 500 words and be specific about what actually changed.
`

  renderReviewFileDiff(inputs: PromptInputs): string {
    let prompt = this.reviewFileDiff
    for (const [key, value] of Object.entries(inputs)) {
      prompt = prompt.replace(`$${key}`, value || '')
    }
    return prompt
  }

  renderSummarizeChanges(inputs: PromptInputs): string {
    let prompt = this.summarizeChanges
    for (const [key, value] of Object.entries(inputs)) {
      prompt = prompt.replace(`$${key}`, value || '')
    }
    return prompt
  }
}

export const prompts = new Prompts()
