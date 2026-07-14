function statusCodeOf(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as { status?: unknown; statusCode?: unknown };
  const value = record.statusCode ?? record.status;
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

export function publicReviewError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/Invalid JSON response|Type validation failed/i.test(raw)) {
    return '模型接口返回了不兼容的响应格式（Invalid JSON response），请检查 provider 与 base URL 协议是否匹配';
  }
  if (raw.startsWith('模型缺少 apiKey')) return '模型配置缺少 apiKey';
  if (raw.startsWith('openai-compatible 必须配置 apiBaseUrl')) return 'openai-compatible 模型配置缺少 apiBaseUrl';
  if (raw.startsWith('不支持的模型 provider')) return '模型 provider 配置不受支持';
  if (raw.startsWith('多模型 Verify')) return '多模型 Verify 配置不满足要求';
  if (raw.startsWith('Verify 分片')) return 'Verify 分片没有可用模型，请检查复核模型配置与服务状态';
  if (raw.startsWith('Verify Agent')) return 'Verify Agent 未能生成有效的最终结论';
  if (raw.startsWith('主审查结果')) return '主审查结果格式无效，请检查主审查模型输出';
  if (raw.startsWith('会话缺少 diff 基准')) return '会话缺少 diff 基准，无法执行审查';
  if (raw.startsWith('未配置全局默认模型')) return '未配置全局默认模型，无法执行审查';
  if (raw.startsWith('全局默认模型已停用')) return '全局默认模型已停用，无法执行审查';
  if (raw.startsWith('仓库自定义模型配置不完整')) return '仓库自定义模型配置不完整';
  if (raw.startsWith('该会话未绑定仓库模型配置')) return '该会话未绑定仓库模型配置，无法执行审查';
  const statusCode = statusCodeOf(error);
  return statusCode
    ? `模型调用失败（HTTP ${statusCode}），请检查模型协议、接口地址与服务状态`
    : '模型调用失败，请检查模型协议、接口地址与服务状态';
}
