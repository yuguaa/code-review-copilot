import { describe, expect, it } from 'vitest';
import { readWorkspaceLine } from './tools';

describe('readWorkspaceLine', () => {
  const workdir = process.cwd();

  it('只签发工作区内真实存在的代码行', async () => {
    await expect(readWorkspaceLine(workdir, 'server/modules/agent/tools.ts', 1)).resolves.toMatchObject({
      path: 'server/modules/agent/tools.ts',
      line: 1,
    });
  });

  it('拒绝不存在文件、越界行号和工作区逃逸', async () => {
    await expect(readWorkspaceLine(workdir, 'server/not-found.ts', 1)).rejects.toThrow();
    await expect(readWorkspaceLine(workdir, 'server/modules/agent/tools.ts', 999_999)).rejects.toThrow('行号越界');
    await expect(readWorkspaceLine(workdir, '../outside.ts', 1)).rejects.toThrow('路径越界');
  });
});
