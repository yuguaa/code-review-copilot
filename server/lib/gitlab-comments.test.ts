import { describe, expect, it } from 'vitest';
import {
  buildCommitCommentPayload,
  buildMergeRequestCommentPayload,
  formatCommitCommentBody,
} from './gitlab-comments';

describe('gitlab comment payload helpers', () => {
  it('构造 MR 行级评论 position，并忽略未提供的行号', () => {
    expect(
      buildMergeRequestCommentPayload('body', {
        base_sha: 'base',
        head_sha: 'head',
        start_sha: 'start',
        old_path: 'src/a.ts',
        new_path: 'src/a.ts',
        position_type: 'text',
        new_line: 12,
      }),
    ).toEqual({
      body: 'body',
      position: {
        base_sha: 'base',
        head_sha: 'head',
        start_sha: 'start',
        old_path: 'src/a.ts',
        new_path: 'src/a.ts',
        position_type: 'text',
        new_line: 12,
      },
    });
  });

  it('格式化 commit 文件评论标题', () => {
    expect(formatCommitCommentBody('问题描述', { path: 'src/a.ts', line: 8 })).toBe('**文件**: `src/a.ts` (行 8)\n\n问题描述');
  });

  it('支持 commit 评论重试时去掉行级定位字段', () => {
    expect(buildCommitCommentPayload('问题描述', { path: 'src/a.ts', line: 8, line_type: 'new' }, false)).toEqual({
      note: '**文件**: `src/a.ts` (行 8)\n\n问题描述',
    });
  });
});
