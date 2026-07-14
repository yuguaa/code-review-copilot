import { describe, expect, it } from 'vitest';
import { publicReviewError } from './review-error';

describe('publicReviewError', () => {
  it('把已知协议错误映射为固定诊断，不公开第三方原文', () => {
    const result = publicReviewError(
      new Error('Invalid JSON response database-password-raw-secret'),
    );

    expect(result).toContain('Invalid JSON response');
    expect(result).not.toContain('database-password-raw-secret');
  });

  it('未知第三方错误只输出固定文案', () => {
    expect(publicReviewError('credential=raw-secret')).toBe('模型调用失败，请检查模型协议、接口地址与服务状态');
  });

  it('第三方伪造内部错误前缀时也不回显后续原文', () => {
    const result = publicReviewError('Verify 分片 verifier-1 credential=raw-secret');

    expect(result).toBe('Verify 分片没有可用模型，请检查复核模型配置与服务状态');
    expect(result).not.toContain('raw-secret');
  });

  it('主审查正文不可判定时返回主结果错误，而不是 Verify 配置错误', () => {
    expect(publicReviewError(new Error('主审查结果未明确声明无问题'))).toBe(
      '主审查结果格式无效，请检查主审查模型输出',
    );
  });
});
