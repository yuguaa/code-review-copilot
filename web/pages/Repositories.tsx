import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { Button, Card, Field, Input, Select, Textarea, PageShell } from '../components/ui';

type Account = { id: string; url: string };
type Project = { id: number; name: string; path: string; defaultBranch: string };
type Repo = {
  id: string;
  name: string;
  path: string;
  gitLabProjectId: number;
  watchBranches: string | null;
  autoReview: boolean;
  modelProvider: string;
  modelId: string;
};

const emptyForm = {
  gitLabAccountId: '',
  gitLabProjectId: '',
  name: '',
  path: '',
  watchBranches: 'main',
  autoReview: true,
  modelProvider: 'openai',
  modelId: 'gpt-4o',
  apiKey: '',
  apiBaseUrl: '',
  maxSteps: 16,
  defaultReviewPrompt: '',
  enableMrComment: true,
  enableDingtalk: false,
  dingtalkWebhook: '',
  dingtalkSecret: '',
};

export function Repositories() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const webhookUrl = `${location.origin}/api/webhook/gitlab`;

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    const [r, a] = await Promise.all([
      api<{ repositories: Repo[] }>('/api/repositories').catch(() => ({ repositories: [] })),
      api<{ accounts: Account[] }>('/api/settings/gitlab').catch(() => ({ accounts: [] })),
    ]);
    setRepos(r.repositories);
    setAccounts(a.accounts);
    if (a.accounts[0] && !form.gitLabAccountId) set('gitLabAccountId', a.accounts[0].id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void load();
  }, [load]);

  const fetchProjects = async () => {
    if (!form.gitLabAccountId) return toast.error('请先选择 GitLab 账号');
    const d = await api<{ projects: Project[] }>(
      `/api/settings/gitlab/${form.gitLabAccountId}/projects?search=${encodeURIComponent(search)}`,
    ).catch(() => ({ projects: [] }));
    setProjects(d.projects);
    if (d.projects.length === 0) toast.message('没有拉到项目');
  };

  const pickProject = (p: Project) => {
    set('gitLabProjectId', String(p.id));
    set('name', p.name);
    set('path', p.path);
    setProjects([]);
  };

  const submit = async () => {
    if (!form.gitLabAccountId || !form.gitLabProjectId || !form.apiKey) {
      return toast.error('请填写账号、项目与模型 API Key');
    }
    setSaving(true);
    try {
      await api('/api/repositories', { method: 'POST', body: JSON.stringify(form) });
      setForm({ ...emptyForm, gitLabAccountId: form.gitLabAccountId });
      await load();
      toast.success('已添加仓库');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '添加失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    await api(`/api/repositories/${id}`, { method: 'DELETE' });
    await load();
  };

  return (
    <PageShell title="仓库配置">
      <Card className="space-y-2">
        <p className="text-xs text-neutral-400">在 GitLab 项目里添加 Webhook（Merge Request events），URL 指向：</p>
        <code className="block break-all rounded-md bg-neutral-950 px-3 py-2 text-xs text-emerald-300">{webhookUrl}</code>
        <p className="text-[11px] text-neutral-600">Secret Token 与对应账号的 Webhook 密钥一致即可验签。</p>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold">添加仓库</h2>
        {accounts.length === 0 ? (
          <p className="text-xs text-amber-400">请先到「设置」添加 GitLab 账号</p>
        ) : (
          <>
            <Field label="GitLab 账号">
              <Select value={form.gitLabAccountId} onChange={(e) => set('gitLabAccountId', e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.url}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="选择项目" hint="按名称搜索后从下方点击选中，自动填入项目 ID / 名称 / 路径">
              <div className="flex gap-2">
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索项目名…" />
                <Button variant="ghost" onClick={fetchProjects} type="button">
                  拉取
                </Button>
              </div>
            </Field>
            {projects.length > 0 && (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-neutral-800 p-1">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => pickProject(p)}
                    className="block w-full rounded px-2 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800"
                  >
                    {p.path} <span className="text-neutral-600">#{p.id}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              <Field label="项目 ID">
                <Input value={form.gitLabProjectId} onChange={(e) => set('gitLabProjectId', e.target.value)} />
              </Field>
              <Field label="名称">
                <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field label="路径">
                <Input value={form.path} onChange={(e) => set('path', e.target.value)} />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label="模型 Provider">
                <Select value={form.modelProvider} onChange={(e) => set('modelProvider', e.target.value)}>
                  <option value="openai">openai</option>
                  <option value="anthropic">anthropic</option>
                  <option value="openai-compatible">openai-compatible</option>
                </Select>
              </Field>
              <Field label="模型 ID">
                <Input value={form.modelId} onChange={(e) => set('modelId', e.target.value)} placeholder="gpt-4o / claude-3-5-sonnet" />
              </Field>
              <Field label="最大步数">
                <Input type="number" value={form.maxSteps} onChange={(e) => set('maxSteps', Number(e.target.value))} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="模型 API Key">
                <Input type="password" value={form.apiKey} onChange={(e) => set('apiKey', e.target.value)} />
              </Field>
              <Field label="API Base URL（openai-compatible 必填）">
                <Input value={form.apiBaseUrl} onChange={(e) => set('apiBaseUrl', e.target.value)} placeholder="https://…/v1" />
              </Field>
            </div>

            <Field label="监听分支" hint="逗号分隔，支持通配符，如 main,release-*；留空=全部">
              <Input value={form.watchBranches} onChange={(e) => set('watchBranches', e.target.value)} />
            </Field>

            <Field label="默认审查提示词（可选）" hint="webhook 首轮审查的额外要求，会追加到内置审查指令之后">
              <Textarea
                rows={3}
                value={form.defaultReviewPrompt}
                onChange={(e) => set('defaultReviewPrompt', e.target.value)}
                placeholder="例如：重点关注鉴权与数据库事务一致性"
              />
            </Field>

            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {([
                ['autoReview', '开启 Webhook 自动审查'],
                ['enableMrComment', '回写 MR 评论'],
                ['enableDingtalk', '推送钉钉'],
              ] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-sm text-neutral-300">
                  <input
                    type="checkbox"
                    checked={form[k]}
                    onChange={(e) => set(k, e.target.checked)}
                    className="h-4 w-4 rounded border-neutral-700 bg-neutral-950"
                  />
                  {label}
                </label>
              ))}
            </div>

            {form.enableDingtalk && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="钉钉机器人 Webhook">
                  <Input
                    value={form.dingtalkWebhook}
                    onChange={(e) => set('dingtalkWebhook', e.target.value)}
                    placeholder="https://oapi.dingtalk.com/robot/send?access_token=…"
                  />
                </Field>
                <Field label="钉钉加签密钥（可选）">
                  <Input
                    type="password"
                    value={form.dingtalkSecret}
                    onChange={(e) => set('dingtalkSecret', e.target.value)}
                    placeholder="SEC…"
                  />
                </Field>
              </div>
            )}

            <Button onClick={submit} disabled={saving}>
              {saving ? '保存中…' : '添加仓库'}
            </Button>
          </>
        )}
      </Card>

      <div className="space-y-3">
        {repos.map((r) => (
          <Card key={r.id} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-neutral-200">{r.path}</p>
              <p className="text-[11px] text-neutral-500">
                {r.modelProvider}/{r.modelId} · 监听 {r.watchBranches || '全部'} · 自动审查 {r.autoReview ? '开' : '关'}
              </p>
            </div>
            <Button variant="danger" onClick={() => remove(r.id)}>
              删除
            </Button>
          </Card>
        ))}
        {repos.length === 0 && <p className="text-center text-xs text-neutral-600">还没有配置仓库</p>}
      </div>
    </PageShell>
  );
}
