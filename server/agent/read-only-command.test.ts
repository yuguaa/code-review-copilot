import { describe, expect, it } from 'vitest';
import { isReadOnlyCommand } from './read-only-command';

describe('isReadOnlyCommand（bash 安全门禁）', () => {
  it('放行只读命令与只读管道', () => {
    expect(isReadOnlyCommand('grep -n foo src')).toBe(true);
    expect(isReadOnlyCommand('rg -n TODO')).toBe(true);
    expect(isReadOnlyCommand('cat a.ts | head -20')).toBe(true);
    expect(isReadOnlyCommand('find . -name "*.ts"')).toBe(true);
    expect(isReadOnlyCommand('cat a 2>&1')).toBe(true);
    expect(isReadOnlyCommand("sed -n '10,50p' a.ts")).toBe(true);
    expect(isReadOnlyCommand("grep -n 'end$' a.ts")).toBe(true);
    expect(isReadOnlyCommand('git log --oneline -5')).toBe(true);
    expect(isReadOnlyCommand('git diff main...HEAD')).toBe(true);
  });

  it('拒绝写/网络/命令替换', () => {
    expect(isReadOnlyCommand('rm -rf /')).toBe(false);
    expect(isReadOnlyCommand('mv a b')).toBe(false);
    expect(isReadOnlyCommand('curl http://x')).toBe(false);
    expect(isReadOnlyCommand('npm install')).toBe(false);
    expect(isReadOnlyCommand('git push')).toBe(false);
    expect(isReadOnlyCommand('git commit -m x')).toBe(false);
    expect(isReadOnlyCommand('echo x > f')).toBe(false);
    expect(isReadOnlyCommand('cat $(whoami)')).toBe(false);
    expect(isReadOnlyCommand('grep foo `ls`')).toBe(false);
    expect(isReadOnlyCommand('cat a && rm b')).toBe(false);
    expect(isReadOnlyCommand('')).toBe(false);
  });

  it('堵住换行/单 & 分段绕过（多命令压平）', () => {
    expect(isReadOnlyCommand('cat foo\nrm -rf x')).toBe(false);
    expect(isReadOnlyCommand('cat foo & rm -rf x')).toBe(false);
    expect(isReadOnlyCommand('echo hi\ntouch marker')).toBe(false);
  });

  it('堵住数字 fd 写重定向', () => {
    expect(isReadOnlyCommand('echo pwned 1>/tmp/evil')).toBe(false);
    expect(isReadOnlyCommand('echo hi 9>/tmp/z')).toBe(false);
    expect(isReadOnlyCommand('cat a 2>/dev/null')).toBe(false);
  });

  it('堵住变量展开泄漏环境变量', () => {
    expect(isReadOnlyCommand('echo $DATABASE_URL')).toBe(false);
    expect(isReadOnlyCommand('echo ${SECRET}')).toBe(false);
    expect(isReadOnlyCommand('cat $HOME/.env')).toBe(false);
  });

  it('剔除解释器类命令（awk/xargs）', () => {
    expect(isReadOnlyCommand("awk 'BEGIN{system(\"id\")}'")).toBe(false);
    expect(isReadOnlyCommand('find . | xargs rm')).toBe(false);
  });

  it('拦白名单命令的写/执行参数', () => {
    expect(isReadOnlyCommand('find . -delete')).toBe(false);
    expect(isReadOnlyCommand('find . -exec rm {} ;')).toBe(false);
    expect(isReadOnlyCommand("sed -i 's/a/b/' f")).toBe(false);
    expect(isReadOnlyCommand("sed -i.bak 's/a/b/' f")).toBe(false);
    expect(isReadOnlyCommand('sort -o out.txt f')).toBe(false);
  });
});
