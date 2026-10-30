import { defineTool } from '@earendil-works/pi-coding-agent';
import { Prisma } from '@prisma/client';
import { Value } from 'typebox/value';
import { ZodError } from 'zod';

import type { Static, TSchema } from 'typebox';

const fieldLabels: Record<string, string> = { title: '标题', text: '正文', query: '查询词', connectionId: '连接', contactIds: '收件人', recipient: '收件人' };

export function definePiServiceTool<T extends TSchema, R>(options: {
  name: string; label: string; description: string; parameters: T;
  execute(input: Static<T>, signal?: AbortSignal): Promise<R> | R;
}) {
  return defineTool({ ...options, execute: (_id, input, signal) => Promise.resolve().then(() => {
    signal?.throwIfAborted();
    if (!Value.Check(options.parameters, input)) throw new Error(`${options.label}参数无效，请按工具要求填写且不要添加额外字段`);
    return options.execute(input, signal);
  }).then((details) => {
    signal?.throwIfAborted();
    const result = details ?? null;
    let text: string;
    try {
      const serialized = JSON.stringify(result);
      if (serialized === undefined) throw new Error('工具结果不是 JSON 数据');
      text = serialized;
    } catch (error) {
      throw new Error(`${options.label}返回的数据无法转换为 JSON；操作可能已执行，请勿自动重试`, { cause: error });
    }
    return { content: [{ type: 'text' as const, text }], details: result };
  }).catch((error: unknown) => {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof ZodError) {
      const fields = [...new Set(error.issues.map((issue) => fieldLabels[String(issue.path[0])] ?? '数据'))];
      throw new Error(`${options.label}的${fields.join('、')}为空或格式不正确，请检查必填内容或重新查询后重试`, { cause: error });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new Error(`${options.label}所需的记录不存在或已停用，请重新查询后重试`, { cause: error });
    }
    throw error;
  }) });
}
