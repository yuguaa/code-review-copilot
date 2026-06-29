import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { Button, Card, Field, Input, Select, Textarea, PageShell } from '../components/ui';

type Account = { id: string; url: string };
type AIModel = { id: string; provider: string; modelId: string; isDefault: boolean };
type Project = { id: number; name: string; path: string; defaultBranch: string };
type Repo = {
  id: string;
  gitLabAccountId: string;
  name: string;
  path: string;
  gitLabProjectId: number;
  watchBranches: string | null;
  autoReview: boolean;
  defaultAIModelId: string | null;
  customProvider: string | null;
  customModelId: string | null;
  customApiBaseUrl: string | null;
  customMaxSteps: number | null;
  defaultReviewPrompt: string | null;
  enableMrComment: boolean;
  enableDingtalk: boolean;
  dingtalkWebhook: string | null;
  defaultAIModel: AIModel | null;
  hasCustomApiKey: boolean;
};

const emptyForm = {
  gitLabAccountId: '',
  gitLabProjectId: '',
  name: '',
  path: '',
  watchBranches: 'main',
  autoReview: true,
  defaultAIModelId: '',
  useCustomModel: false,
  customProvider: 'openai',
  customModelId: '',
  customApiKey: '',
  customApiBaseUrl: '',
  customMaxSteps: 16,
  defaultReviewPrompt: '',
  enableMrComment: false,
  enableDingtalk: true,
  dingtalkWebhook: '',
  dingtalkSecret: '',
};

export function Repositories() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [models, setModels] = useState<AIModel[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ ...emptyForm });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const webhookUrl = `${location.origin}/api/webhook/gitlab`;

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    const [repositoryResult, accountResult, modelResult] = await Promise.all([
      api<{ repositories: Repo[] }>('/api/repositories').catch(() => ({ repositories: [] })),
      api<{ accounts: Account[] }>('/api/settings/gitlab').catch(() => ({ accounts: [] })),
      api<{ models: AIModel[] }>('/api/settings/models').catch(() => ({ models: [] })),
    ]);
    setRepos(repositoryResult.repositories);
    setAccounts(accountResult.accounts);
    setModels(modelResult.models);
    if (accountResult.accounts[0] && !form.gitLabAccountId) set('gitLabAccountId', accountResult.accounts[0].id);
    if (modelResult.models[0] && !form.defaultAIModelId) {
      set('defaultAIModelId', modelResult.models.find((m) => m.isDefault)?.id ?? modelResult.models[0].id);
    }
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

  const resetForm = () => {
    setEditingId(null);
    setForm({ ...emptyForm, gitLabAccountId: form.gitLabAccountId, defaultAIModelId: form.defaultAIModelId });
    setProjects([]);
  };

  const edit = (repo: Repo) => {
    setEditingId(repo.id);
    setForm({
      ...emptyForm,
      gitLabAccountId: repo.gitLabAccountId,
      gitLabProjectId: String(repo.gitLabProjectId),
      name: repo.name,
      path: repo.path,
      watchBranches: repo.watchBranches ?? '',
      autoReview: repo.autoReview,
      defaultAIModelId: repo.defaultAIModelId ?? '',
      useCustomModel: Boolean(repo.customProvider || repo.customModelId || repo.hasCustomApiKey),
      customProvider: repo.customProvider ?? 'openai',
      customModelId: repo.customModelId ?? '',
      customApiKey: '',
      customApiBaseUrl: repo.customApiBaseUrl ?? '',
      customMaxSteps: repo.customMaxSteps ?? 16,
      defaultReviewPrompt: repo.defaultReviewPrompt ?? '',
      enableMrComment: repo.enableMrComment,
      enableDingtalk: repo.enableDingtalk,
      dingtalkWebhook: repo.dingtalkWebhook ?? '',
      dingtalkSecret: '',
    });
    setProjects([]);
  };

  const submit = () => {
    if (!form.gitLabAccountId || !form.gitLabProjectId || (!form.defaultAIModelId && !form.useCustomModel)) {
      return toast.error('请填写账号、项目与默认模型');
    }
    if (form.useCustomModel && (!form.customProvider || !form.customModelId || (!editingId && !form.customApiKey))) {
      return toast.error('请填写完整的仓库自定义模型配置');
    }
    setSaving(true);
    const payload = {
      ...form,
      customProvider: form.useCustomModel ? form.customProvider : null,
      customModelId: form.useCustomModel ? form.customModelId : null,
      customApiKey: form.useCustomModel ? form.customApiKey : null,
      customApiBaseUrl: form.useCustomModel ? form.customApiBaseUrl : null,
      customMaxSteps: form.useCustomModel ? form.customMaxSteps : null,
    };
    const request = editingId
      ? api(`/api/repositories/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : api('/api/repositories', { method: 'POST', body: JSON.stringify(payload) });
    request
      .then(() => {
        setForm({ ...emptyForm, gitLabAccountId: form.gitLabAccountId, defaultAIModelId: form.defaultAIModelId });
        setEditingId(null);
        return load();
      })
      .then(() => toast.success(editingId ? '已更新仓库' : '已添加仓库'))
      .catch((e) => toast.error(e instanceof Error ? e.message : editingId ? '更新失败' : '添加失败'))
      .finally(() => setSaving(false));
  };

  const remove = async (id: string) => {
    await api(`/api/repositories/${id}`, { method: 'DELETE' });
    await load();
  };

  return (
    <PageShell title="仓库配置">
      <Card className="space-y-2">
        <p className="text-xs text-slate-500">在 GitLab 项目里添加 Webhook（Merge Request events），URL 指向：</p>
        <code className="block break-all rounded-md bg-slate-100 px-3 py-2 text-xs text-emerald-700">{webhookUrl}</code>
        <p className="text-[11px] text-slate-400">Secret Token 与对应账号的 Webhook 密钥一致即可验签。</p>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{editingId ? '编辑仓库' : '添加仓库'}</h2>
          {editingId && (
            <Button variant="ghost" onClick={resetForm} type="button">
              取消编辑
            </Button>
          )}
        </div>
        {accounts.length === 0 ? (
          <p className="text-xs text-amber-600">请先到「设置」添加 GitLab 账号</p>
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
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => pickProject(p)}
                    className="block w-full rounded px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
                  >
                    {p.path} <span className="text-slate-400">#{p.id}</span>
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

            <Field label="默认模型" hint="使用「设置」里的全局模型；需要特殊模型时再开启仓库自定义模型">
              <Select value={form.defaultAIModelId} onChange={(e) => set('defaultAIModelId', e.target.value)}>
                <option value="">请选择模型</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.provider}/{m.modelId}{m.isDefault ? '（默认）' : ''}
                  </option>
                ))}
              </Select>
            </Field>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.useCustomModel}
                onChange={(e) => set('useCustomModel', e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 bg-white"
              />
              使用仓库自定义模型
            </label>

            {form.useCustomModel && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="模型 Provider">
                    <Select value={form.customProvider} onChange={(e) => set('customProvider', e.target.value)}>
                      <option value="openai">openai</option>
                      <option value="anthropic">anthropic</option>
                      <option value="openai-compatible">openai-compatible</option>
                    </Select>
                  </Field>
                  <Field label="模型 ID">
                    <Input value={form.customModelId} onChange={(e) => set('customModelId', e.target.value)} placeholder="gpt-4o" />
                  </Field>
                  <Field label="最大步数">
                    <Input type="number" value={form.customMaxSteps} onChange={(e) => set('customMaxSteps', Number(e.target.value))} />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="模型 API Key">
                    <Input type="password" value={form.customApiKey} onChange={(e) => set('customApiKey', e.target.value)} />
                  </Field>
                  <Field label="API Base URL（openai-compatible 必填）">
                    <Input value={form.customApiBaseUrl} onChange={(e) => set('customApiBaseUrl', e.target.value)} placeholder="https://.../v1" />
                  </Field>
                </div>
              </>
            )}

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
                <label key={k} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form[k]}
                    onChange={(e) => set(k, e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 bg-white"
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
              {saving ? '保存中…' : editingId ? '保存修改' : '添加仓库'}
            </Button>
          </>
        )}
      </Card>

      <div className="space-y-3">
        {repos.map((r) => (
          <Card key={r.id} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-slate-900">{r.path}</p>
              <p className="text-[11px] text-slate-500">
                模型 {r.customProvider && r.customModelId ? `${r.customProvider}/${r.customModelId}` : `${r.defaultAIModel?.provider ?? '未配置'}/${r.defaultAIModel?.modelId ?? '-'}`} · 监听 {r.watchBranches || '全部'} · 自动审查 {r.autoReview ? '开' : '关'}
              </p>
            </div>
            <Button variant="ghost" onClick={() => edit(r)}>
              编辑
            </Button>
            <Button variant="danger" onClick={() => remove(r.id)}>
              删除
            </Button>
          </Card>
        ))}
        {repos.length === 0 && <p className="text-center text-xs text-slate-400">还没有配置仓库</p>}
      </div>
    </PageShell>
  );
}
