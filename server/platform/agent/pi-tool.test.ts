import { Prisma } from '@prisma/client';
import { HTTPException } from 'hono/http-exception';
import { Type } from 'typebox';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { definePiServiceTool } from './pi-tool';

const parameters = Type.Object({}, { additionalProperties: false });

describe('Pi Service 工具结果和错误边界', () => {
  it('void 结果变成可传输的 null，而不是无效 text', () => {
    let calls = 0;
    const tool = definePiServiceTool({ name: 'empty', label: '空结果', description: 'Void result', parameters,
      execute: () => { calls += 1; } });
    return tool.execute('call', {}, undefined, undefined, {} as never).then((result) => {
      expect(result).toEqual({ content: [{ type: 'text', text: 'null' }], details: null });
      expect(calls).toBe(1);
    });
  });

  it.each(['bigint', 'circular'])('不可序列化的 %s 明确报错，不能被误认为操作未执行', (kind) => {
    const value: Record<string, unknown> = kind === 'bigint' ? { count: BigInt(1) } : {};
    if (kind === 'circular') value.self = value;
    let calls = 0;
    const tool = definePiServiceTool({ name: 'invalid', label: '返回数据', description: 'Invalid result', parameters,
      execute: () => { calls += 1; return value; } });
    return expect(tool.execute('call', {}, undefined, undefined, {} as never)).rejects.toThrow('操作可能已执行，请勿自动重试')
      .then(() => expect(calls).toBe(1));
  });

  it('额外参数在执行前被拒绝并给出中文提示', () => {
    let calls = 0;
    const tool = definePiServiceTool({ name: 'strict', label: '测试工具', description: 'Strict input', parameters,
      execute: () => { calls += 1; return { ok: true }; } });
    return expect(tool.execute('call', { extra: 'no' }, undefined, undefined, {} as never)).rejects.toThrow('参数无效')
      .then(() => expect(calls).toBe(0));
  });

  it('服务的 Zod 参数错误不向模型或界面泄露英文错误栈', () => {
    const tool = definePiServiceTool({ name: 'draft', label: '准备消息', description: 'Validate service input', parameters,
      execute: () => z.object({ title: z.string().trim().min(1) }).parse({ title: ' ' }) });
    return expect(tool.execute('call', {}, undefined, undefined, {} as never)).rejects.toThrow('标题');
  });

  it('记录不存在转换为重新查询提示，不泄露数据库诊断', () => {
    const tool = definePiServiceTool({ name: 'missing', label: '读取连接', description: 'Missing record', parameters,
      execute: () => { throw new Prisma.PrismaClientKnownRequestError('private database details', { code: 'P2025', clientVersion: '6.19.2' }); } });
    return expect(tool.execute('call', {}, undefined, undefined, {} as never)).rejects.toThrow('记录不存在或已停用，请重新查询');
  });

  it('保留已有中文业务错误和取消根因', () => {
    const failure = new HTTPException(409, { message: '登录身份已变化，请重新确认草稿' });
    const tool = definePiServiceTool({ name: 'business', label: '业务操作', description: 'Business failure', parameters,
      execute: () => { throw failure; } });
    const controller = new AbortController();
    controller.abort(new Error('用户停止'));
    return expect(tool.execute('call', {}, undefined, undefined, {} as never)).rejects.toBe(failure)
      .then(() => expect(tool.execute('call', {}, controller.signal, undefined, {} as never)).rejects.toBe(controller.signal.reason));
  });
});
