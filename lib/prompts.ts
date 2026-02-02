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
Output: Review comments in markdown with exact line number ranges in new hunks. Start and end line numbers must be within the same hunk. For single-line comments, start=end line number. Must use example response format below.
Use fenced code blocks using the relevant language identifier where applicable.
Don't annotate code snippets with line numbers. Format and indent code correctly.
Do not use \`suggestion\` code blocks.
For fixes, use \`diff\` code blocks, marking changes with \`+\` or \`-\`. The line number range for comments with fix snippets must exactly match the range to replace in the new hunk.

- Do NOT provide general feedback, summaries, explanations of changes, or praises for making good additions.
- Focus solely on offering specific, objective insights based on the given context and refrain from making broad comments about potential impacts on the system or question intentions behind the changes.

If there are no issues found on a line range, you MUST respond with the text \`LGTM!\` for that line range in the review section.

## Review Levels

Please categorize issues by severity:
- **严重** (Critical): Security vulnerabilities, major bugs, performance issues, breaking changes
- **一般** (Normal): Code quality issues, minor bugs, inconsistent patterns
- **建议** (Suggestion): Best practices, optimizations, style improvements

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
