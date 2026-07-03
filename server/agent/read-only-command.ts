/**
 * 只读命令白名单（首词）。git 另按子命令二次校验。
 * 刻意不含 awk / xargs：前者是可 system() 的通用解释器，后者会把参数当命令执行，
 * 二者无法靠参数级校验安全收敛。列出的命令再按 hasDangerousArgs 剔除其写文件/执行子参数。
 */
const READONLY_CMDS = new Set([
  'grep', 'rg', 'find', 'cat', 'head', 'tail', 'ls', 'wc', 'tree', 'sed',
  'sort', 'uniq', 'diff', 'pwd', 'echo', 'basename', 'dirname', 'realpath',
  'stat', 'file', 'cut', 'nl', 'comm', 'true', 'test',
]);

const READONLY_GIT_SUB = new Set([
  'log', 'diff', 'show', 'status', 'blame', 'ls-files', 'ls-tree', 'cat-file',
  'rev-parse', 'grep', 'shortlog', 'describe', 'branch', 'tag', 'remote', 'config',
]);

/** find 会执行命令或写文件的动作参数。 */
const FIND_WRITE_ACTIONS = new Set(['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprintf', '-fls', '-fprint0']);

/** 白名单命令里仍会写文件/执行命令的危险参数：命中即拒。 */
function hasDangerousArgs(head: string, args: string[]): boolean {
  if (head === 'find') return args.some((arg) => FIND_WRITE_ACTIONS.has(arg));
  // sed -i / -i.bak / --in-place 原地改写文件（-i 是 sed 唯一含 i 的短选项）
  if (head === 'sed') return args.some((arg) => /^-[a-z]*i/.test(arg) || arg.startsWith('--in-place'));
  // sort -o / --output 写文件
  if (head === 'sort') return args.some((arg) => arg === '-o' || arg.startsWith('-o') || arg.startsWith('--output'));
  return false;
}

/**
 * 判断一条命令是否纯只读。导出供单测。
 * 规则：拆分所有 shell 串联符（| & ; 换行）逐段校验首词在白名单内且无危险参数；
 * 禁止写重定向、命令替换与变量展开（变量展开会外泄进程环境里的密钥）。
 */
export function isReadOnlyCommand(command: string): boolean {
  const cmd = command.trim();
  if (!cmd) return false;
  // 写重定向：任何 > / >> 只放行 fd 复制形式（>&1、2>&1），其余（>file、1>file、2>/dev/null）一律拒
  if (/>>?(?!&)/.test(cmd)) return false;
  // 命令替换（反引号、$()）与变量展开（$VAR、${VAR}）——$ 作为正则行尾锚点（后跟引号/空白/结尾）仍放行
  if (/[`]/.test(cmd) || /\$[({A-Za-z_]/.test(cmd)) return false;
  // 换行与单 & 也是命令分隔符，必须一并拆分，否则多条命令被压平后只校验首词；
  // 但 >& 里的 & 是 fd 复制（如 2>&1），用负向后顾排除，不当分隔符
  const segments = cmd.split(/\||;|\n|\r|(?<!>)&/);
  for (const segment of segments) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const head = tokens[0];
    const args = tokens.slice(1);
    if (head === 'git') {
      const sub = args.find((token) => !token.startsWith('-'));
      if (!sub || !READONLY_GIT_SUB.has(sub)) return false;
    } else if (!READONLY_CMDS.has(head)) {
      return false;
    }
    if (hasDangerousArgs(head, args)) return false;
  }
  return true;
}
