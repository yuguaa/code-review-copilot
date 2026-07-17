import { Link } from 'react-router-dom';
import BookOpenCheck from 'lucide-react/dist/esm/icons/book-open-check';
import Bot from 'lucide-react/dist/esm/icons/bot';
import ChartColumn from 'lucide-react/dist/esm/icons/chart-column';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check';
import CircleAlert from 'lucide-react/dist/esm/icons/circle-alert';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import FolderGit2 from 'lucide-react/dist/esm/icons/folder-git-2';
import MessageSquareText from 'lucide-react/dist/esm/icons/message-square-text';
import Settings2 from 'lucide-react/dist/esm/icons/settings-2';
import Webhook from 'lucide-react/dist/esm/icons/webhook';
import { PageShell } from '../components/ui/page-shell';

const sectionLinkClass =
  'flex min-h-10 items-center rounded-[var(--r-sm)] px-3 text-sm text-[var(--muted)] transition-[background-color,color,transform] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)] active:scale-[0.98]';

const actionLinkClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--r-sm)] border border-[var(--line-default)] bg-[var(--surface-card)] px-4 py-2 text-sm font-semibold text-[var(--ink)] shadow-[var(--shadow-sm)] transition-[background-color,border-color,transform] hover:border-[var(--line-accent)] hover:bg-[var(--surface-hover)] active:scale-[0.98]';

const faqClass =
  'group border-b border-[var(--line-subtle)] last:border-b-0 [&_summary::-webkit-details-marker]:hidden';

export function Help() {
  return (
    <PageShell title="帮助中心" maxWidth="max-w-6xl">
      <div className="grid items-start gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="sticky top-24 rounded-[var(--r-md)] bg-[var(--surface-soft)] p-2 max-lg:static">
          <p className="caption px-3 pb-2 pt-1 text-[var(--muted)]">使用指南</p>
          <nav aria-label="帮助中心目录" className="grid max-lg:grid-cols-2 max-sm:grid-cols-1">
            <a href="#quick-start" className={sectionLinkClass}>快速开始</a>
            <a href="#daily-use" className={sectionLinkClass}>日常使用</a>
            <a href="#configuration" className={sectionLinkClass}>配置说明</a>
            <a href="#status" className={sectionLinkClass}>状态与排查</a>
            <a href="#faq" className={sectionLinkClass}>常见问题</a>
          </nav>
        </aside>

        <div className="min-w-0 space-y-12">
          <section className="overflow-hidden rounded-[var(--r-lg)] bg-[var(--surface-card)] shadow-[var(--shadow-md)]">
            <div className="grid gap-6 p-7 md:grid-cols-[minmax(0,1fr)_180px] md:p-8">
              <div>
                <span className="caption text-[var(--primary)]">CODE REVIEW COPILOT</span>
                <h2 className="font-display mt-2 text-2xl leading-tight text-[var(--ink)]">从接入仓库到完成一次代码审查</h2>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--muted)]">
                  先配置 GitLab 账号和模型，再添加仓库与 Webhook。之后 Merge Request 或 Push 事件会自动生成审查会话，结论保留在工作台，并按仓库设置回写 GitLab 或推送钉钉。
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Link to="/settings" className={actionLinkClass}>
                    <Settings2 size={15} /> 前往设置
                  </Link>
                  <Link to="/repositories" className={actionLinkClass}>
                    <FolderGit2 size={15} /> 配置仓库
                  </Link>
                </div>
              </div>
              <div className="flex min-h-36 items-center justify-center rounded-[var(--r-md)] bg-[var(--state-info-bg)] text-[var(--primary)]">
                <BookOpenCheck size={54} strokeWidth={1.5} aria-hidden="true" />
              </div>
            </div>
          </section>

          <section id="quick-start" className="scroll-mt-24">
            <div className="mb-5">
              <span className="caption text-[var(--primary)]">01 / QUICK START</span>
              <h2 className="font-display mt-1 text-xl text-[var(--ink)]">快速开始</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">按顺序完成以下步骤，即可建立完整的自动审查链路。</p>
            </div>
            <ol className="line-list">
              {[
                ['1', '添加 GitLab 账号', '进入「设置」，填写 GitLab 实例地址、具有 api 权限的 Personal Access Token，以及用于 Webhook 验签的密钥。保存后点击「测试连接」。'],
                ['2', '配置可用模型', '在「全局模型配置」中选择 Provider，填写模型 ID、API Key 与最大步数。测试成功后启用模型，并设置一个默认模型。'],
                ['3', '配置 Tools / Skills', '在「设置」中启用平台默认工具与审查方法。仓库可以显式覆盖这些默认项，关闭的能力不会暴露给 Agent。'],
                ['4', '添加仓库', '进入「仓库配置」，选择 GitLab 账号并拉取项目。确认项目、监听分支、审查提示词、模型和通知选项后保存。'],
                ['5', '创建 GitLab Webhook', '在项目 Webhook 中填写页面展示的 URL，Secret Token 与账号的 Webhook 密钥保持一致，并勾选 Merge Request events 和 Push events。'],
              ].map(([number, title, description]) => (
                <li key={number} className="grid gap-3 p-5 sm:grid-cols-[40px_minmax(0,1fr)] sm:p-6">
                  <span className="flex h-10 w-10 items-center justify-center rounded-[var(--r-md)] bg-[var(--primary)] font-mono text-sm font-semibold text-white">{number}</span>
                  <div>
                    <h3 className="font-display text-base text-[var(--ink)]">{title}</h3>
                    <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section id="daily-use" className="scroll-mt-24">
            <div className="mb-5">
              <span className="caption text-[var(--primary)]">02 / WORKFLOW</span>
              <h2 className="font-display mt-1 text-xl text-[var(--ink)]">日常使用</h2>
            </div>
            <div className="divide-y divide-[var(--line-subtle)] rounded-[var(--r-lg)] bg-[var(--surface-card)] shadow-[var(--shadow-sm)]">
              <article className="grid gap-4 p-6 md:grid-cols-[44px_minmax(0,1fr)]">
                <span className="flex h-11 w-11 items-center justify-center rounded-[var(--r-md)] bg-[var(--state-info-bg)] text-[var(--primary)]"><Webhook size={20} /></span>
                <div>
                  <h3 className="font-display text-base text-[var(--ink)]">自动审查</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--muted)]">监听范围内的 MR 或 Push 事件到达后，系统创建会话并运行 Agent。你可以从左侧会话列表进入，查看状态、分支、提交、作者、工具调用和最终结论。</p>
                </div>
              </article>
              <article className="grid gap-4 p-6 md:grid-cols-[44px_minmax(0,1fr)]">
                <span className="flex h-11 w-11 items-center justify-center rounded-[var(--r-md)] bg-[var(--state-success-bg)] text-[var(--success)]"><MessageSquareText size={20} /></span>
                <div>
                  <h3 className="font-display text-base text-[var(--ink)]">新建对话与继续追问</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--muted)]">点击侧栏顶部「新对话」，选择关联仓库后输入问题。审查会话完成后也可以继续追问，Agent 会沿用该仓库工作区和当前会话上下文。</p>
                </div>
              </article>
              <article className="grid gap-4 p-6 md:grid-cols-[44px_minmax(0,1fr)]">
                <span className="flex h-11 w-11 items-center justify-center rounded-[var(--r-md)] bg-[var(--metric-lilac)] text-[var(--primary)]"><ChartColumn size={20} /></span>
                <div>
                  <h3 className="font-display text-base text-[var(--ink)]">查看数据看板</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--muted)]">进入「数据看板」查看会话趋势、成功率、仓库热度、人员覆盖、失败样本和最近活动，用于定位风险集中点与审查覆盖缺口。</p>
                </div>
              </article>
            </div>
          </section>

          <section id="configuration" className="scroll-mt-24">
            <div className="mb-5">
              <span className="caption text-[var(--primary)]">03 / CONFIGURATION</span>
              <h2 className="font-display mt-1 text-xl text-[var(--ink)]">关键配置说明</h2>
            </div>
            <dl className="grid gap-px overflow-hidden rounded-[var(--r-lg)] bg-[var(--line-default)] shadow-[var(--shadow-sm)] sm:grid-cols-2">
              {[
                ['监听分支', '逗号分隔，支持 main、release-* 等通配符；留空表示全部分支。未匹配的事件不会触发审查。'],
                ['自动审查', '控制 Webhook 事件到达后是否自动运行 Agent。关闭后，仓库仍可用于手动新建对话。'],
                ['回写平台评论', '开启后会把审查结论发布到对应 GitLab MR 或 Commit；关闭时结论仍保留在会话页面。'],
                ['钉钉推送', '开启后需填写机器人 Webhook，可选填加签密钥。审查完成后向群聊推送结果。'],
                ['默认审查提示词', '作为仓库的额外审查要求，追加在内置审查指令之后，适合声明鉴权、事务或性能等关注点。'],
                ['仓库能力覆盖', '仓库 Tools / Skills 覆盖平台默认配置。请只启用审查实际需要的能力，配置结果同时影响审查与后续追问。'],
              ].map(([term, description]) => (
                <div key={term} className="bg-[var(--surface-card)] p-5">
                  <dt className="font-display text-sm text-[var(--ink)]">{term}</dt>
                  <dd className="mt-2 text-sm leading-6 text-[var(--muted)]">{description}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section id="status" className="scroll-mt-24">
            <div className="mb-5">
              <span className="caption text-[var(--primary)]">04 / STATUS</span>
              <h2 className="font-display mt-1 text-xl text-[var(--ink)]">状态与排查顺序</h2>
            </div>
            <div className="rounded-[var(--r-lg)] bg-[var(--surface-card)] p-6 shadow-[var(--shadow-sm)]">
              <div className="grid gap-5 md:grid-cols-3">
                <div>
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--warning)]"><Bot size={16} /> 审查中</span>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Agent 正在读取改动、调用工具或组织结论。可在会话中查看实时活动。</p>
                </div>
                <div>
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--success)]"><CheckCircle2 size={16} /> 已完成</span>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">结论已写入会话；是否回写 GitLab 或推送钉钉取决于仓库配置。</p>
                </div>
                <div>
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--error)]"><CircleAlert size={16} /> 失败</span>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">优先检查模型、GitLab 连接和仓库配置，再从数据看板的失败样本进入对应会话查看原因。</p>
                </div>
              </div>
            </div>
          </section>

          <section id="faq" className="scroll-mt-24">
            <div className="mb-5">
              <span className="caption text-[var(--primary)]">05 / FAQ</span>
              <h2 className="font-display mt-1 text-xl text-[var(--ink)]">常见问题</h2>
            </div>
            <div className="overflow-hidden rounded-[var(--r-lg)] bg-[var(--surface-card)] shadow-[var(--shadow-sm)]">
              {[
                ['Webhook 触发后为什么没有创建审查会话？', '依次确认仓库已启用自动审查、事件类型已勾选、目标分支匹配监听规则、Webhook URL 可从 GitLab 访问，并且 Secret Token 与对应 GitLab 账号的 Webhook 密钥一致。'],
                ['为什么无法拉取 GitLab 项目或读取代码？', '先在「设置」中对 GitLab 账号执行测试连接。确认实例地址正确，Personal Access Token 未过期且具有 api 权限，并且该账号可以访问目标项目。'],
                ['模型测试失败或审查立即失败怎么办？', '检查模型 Provider、模型 ID、API Key 和 Base URL。openai-compatible 必须填写正确的兼容接口地址；模型还需处于启用状态，仓库自定义模型也要单独检查。'],
                ['为什么审查完成后 GitLab 没有评论？', '确认仓库开启了「回写平台评论」，GitLab Token 具有评论权限。关闭该选项不会丢失结果，完整结论仍可在对应会话中查看。'],
                ['为什么没有收到钉钉通知？', '确认仓库开启了「推送钉钉」，机器人 Webhook 可用；若机器人启用了加签，还需填写匹配的 SEC 密钥。'],
                ['平台默认 Tools / Skills 与仓库配置是什么关系？', '设置页维护平台默认能力，仓库页进行显式覆盖。仓库保存的覆盖结果优先生效；被关闭的工具不会提供给 Agent，也不会在追问阶段自动恢复。'],
                ['如何针对某个仓库提出额外审查要求？', '编辑仓库的「默认审查提示词」，写入需要长期关注的规则；临时问题可以在审查会话完成后直接追问。'],
                ['删除会话或仓库会发生什么？', '删除会话会移除该会话及全部消息，无法恢复。删除仓库会移除仓库配置与关联会话记录，并使该仓库的 Webhook 触发失效。'],
              ].map(([question, answer]) => (
                <details key={question} className={faqClass}>
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-[var(--ink)] transition-[background-color] hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--focus-ring)]">
                    <span>{question}</span>
                    <ChevronDown size={16} className="shrink-0 text-[var(--muted)] transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="px-5 pb-5 pr-12 text-sm leading-6 text-[var(--muted)]">{answer}</p>
                </details>
              ))}
            </div>
          </section>
        </div>
      </div>
    </PageShell>
  );
}
