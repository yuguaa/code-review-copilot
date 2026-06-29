import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { Button, Card, Field, Input, PageShell, Select } from '../components/ui';

type Account = {
  id: string;
  url: string;
  isActive: boolean;
  hasAccessToken: boolean;
  hasWebhookSecret: boolean;
};

type AIModel = {
  id: string;
  provider: string;
  modelId: string;
  apiBaseUrl: string | null;
  maxSteps: number;
  isDefault: boolean;
  isActive: boolean;
  hasApiKey: boolean;
};

type Stats = {
  repositoryCount: number;
  activeRepositoryCount: number;
  modelCount: number;
  gitLabAccountCount: number;
  sessionCount: number;
  reviewSessionCount: number;
  chatSessionCount: number;
  messageCount: number;
  latestSessionAt: string | null;
};

const emptyModelForm = {
  provider: 'openai',
  modelId: 'gpt-4o',
  apiKey: '',
  apiBaseUrl: '',
  maxSteps: 16,
  isDefault: true,
};

export function Settings() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [models, setModels] = useState<AIModel[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [url, setUrl] = useState('https://gitlab.com');
  const [accessToken, setAccessToken] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [modelForm, setModelForm] = useState({ ...emptyModelForm });
  const [saving, setSaving] = useState(false);
  const [savingModel, setSavingModel] = useState(false);

  const load = useCallback(async () => {
    const [gitlab, ai, overview] = await Promise.all([
      api<{ accounts: Account[] }>('/api/settings/gitlab').catch(() => ({ accounts: [] })),
      api<{ models: AIModel[] }>('/api/settings/models').catch(() => ({ models: [] })),
      api<{ stats: Stats }>('/api/settings/stats').catch(() => ({ stats: null })),
    ]);
    setAccounts(gitlab.accounts);
    setModels(ai.models);
    setStats(overview.stats);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const setModel = <K extends keyof typeof modelForm>(k: K, v: (typeof modelForm)[K]) => {
    setModelForm((f) => ({ ...f, [k]: v }));
  };

  const add = async () => {
    if (!url || !accessToken) return toast.error('请填写实例地址与访问令牌');
    setSaving(true);
    try {
      await api('/api/settings/gitlab', {
        method: 'POST',
        body: JSON.stringify({ url, accessToken, webhookSecret: webhookSecret || null }),
      });
      setAccessToken('');
      setWebhookSecret('');
      await load();
      toast.success('已添加 GitLab 账号');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '添加失败');
    } finally {
      setSaving(false);
    }
  };

  const test = async (id: string) => {
    const d = await api<{ ok: boolean }>(`/api/settings/gitlab/${id}/test`, { method: 'POST' }).catch(() => ({ ok: false }));
    d.ok ? toast.success('连接正常') : toast.error('连接失败，请检查地址与令牌');
  };

  const remove = async (id: string) => {
    await api(`/api/settings/gitlab/${id}`, { method: 'DELETE' });
    await load();
  };

  const addModel = () => {
    if (!modelForm.provider || !modelForm.modelId || !modelForm.apiKey) {
      return toast.error('请填写模型 Provider、模型 ID 与 API Key');
    }
    setSavingModel(true);
    api('/api/settings/models', {
      method: 'POST',
      body: JSON.stringify(modelForm),
    })
      .then(() => {
        setModelForm({ ...emptyModelForm, isDefault: models.length === 0 });
        return load();
      })
      .then(() => toast.success('已添加全局模型'))
      .catch((e) => toast.error(e instanceof Error ? e.message : '添加失败'))
      .finally(() => setSavingModel(false));
  };

  const setDefaultModel = (id: string) => {
    api(`/api/settings/models/${id}`, { method: 'PATCH', body: JSON.stringify({ isDefault: true }) })
      .then(load)
      .then(() => toast.success('已设为默认模型'));
  };

  const removeModel = (id: string) => {
    api(`/api/settings/models/${id}`, { method: 'DELETE' }).then(load);
  };

  return (
    <PageShell title="设置">
      {stats && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['仓库', `${stats.activeRepositoryCount}/${stats.repositoryCount}`, '启用 / 总数'],
            ['模型', String(stats.modelCount), '可用全局模型'],
            ['会话', String(stats.sessionCount), `审查 ${stats.reviewSessionCount} · 对话 ${stats.chatSessionCount}`],
            ['消息', String(stats.messageCount), stats.latestSessionAt ? `最近 ${new Date(stats.latestSessionAt).toLocaleString()}` : '暂无会话'],
          ].map(([label, value, hint]) => (
            <Card key={label} className="space-y-1 p-4">
              <p className="text-xs font-medium text-slate-500">{label}</p>
              <p className="font-mono text-2xl font-semibold tabular-nums text-slate-950">{value}</p>
              <p className="truncate text-[11px] text-slate-400">{hint}</p>
            </Card>
          ))}
        </div>
      )}

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold">全局模型配置</h2>
        <div className="grid grid-cols-3 gap-3">
          <Field label="模型 Provider">
            <Select value={modelForm.provider} onChange={(e) => setModel('provider', e.target.value)}>
              <option value="openai">openai</option>
              <option value="anthropic">anthropic</option>
              <option value="openai-compatible">openai-compatible</option>
            </Select>
          </Field>
          <Field label="模型 ID">
            <Input value={modelForm.modelId} onChange={(e) => setModel('modelId', e.target.value)} placeholder="gpt-4o" />
          </Field>
          <Field label="最大步数">
            <Input type="number" value={modelForm.maxSteps} onChange={(e) => setModel('maxSteps', Number(e.target.value))} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="API Key">
            <Input type="password" value={modelForm.apiKey} onChange={(e) => setModel('apiKey', e.target.value)} />
          </Field>
          <Field label="API Base URL">
            <Input value={modelForm.apiBaseUrl} onChange={(e) => setModel('apiBaseUrl', e.target.value)} placeholder="https://.../v1" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={modelForm.isDefault}
            onChange={(e) => setModel('isDefault', e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 bg-white"
          />
          设为默认模型
        </label>
        <Button onClick={addModel} disabled={savingModel}>
          {savingModel ? '保存中…' : '添加模型'}
        </Button>
      </Card>

      <div className="space-y-3">
        {models.map((m) => (
          <Card key={m.id} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-slate-900">
                {m.provider}/{m.modelId}
                {m.isDefault && <span className="ml-2 text-[11px] text-emerald-600">默认</span>}
              </p>
              <p className="text-[11px] text-slate-500">
                Key {m.hasApiKey ? '已配置' : '缺失'} · 最大步数 {m.maxSteps} · {m.isActive ? '启用' : '停用'}
              </p>
            </div>
            {!m.isDefault && (
              <Button variant="ghost" onClick={() => setDefaultModel(m.id)}>
                设默认
              </Button>
            )}
            <Button variant="danger" onClick={() => removeModel(m.id)}>
              删除
            </Button>
          </Card>
        ))}
        {models.length === 0 && <p className="text-center text-xs text-slate-400">还没有全局模型配置</p>}
      </div>

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold">添加 GitLab 账号</h2>
        <Field label="实例地址">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://gitlab.com" />
        </Field>
        <Field label="访问令牌 (Personal Access Token)" hint="需 api 权限，用于拉取 diff、发布评论">
          <Input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="glpat-..." />
        </Field>
        <Field label="Webhook 密钥（可选）" hint="与 GitLab 项目 Webhook 的 Secret Token 一致，用于验签">
          <Input type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} />
        </Field>
        <Button onClick={add} disabled={saving}>
          {saving ? '保存中…' : '添加'}
        </Button>
      </Card>

      <div className="space-y-3">
        {accounts.map((a) => (
          <Card key={a.id} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-slate-900">{a.url}</p>
              <p className="text-[11px] text-slate-500">
                令牌 {a.hasAccessToken ? '已配置' : '缺失'} · Webhook 密钥 {a.hasWebhookSecret ? '已配置' : '未配置'}
              </p>
            </div>
            <Button variant="ghost" onClick={() => test(a.id)}>
              测试连接
            </Button>
            <Button variant="danger" onClick={() => remove(a.id)}>
              删除
            </Button>
          </Card>
        ))}
        {accounts.length === 0 && <p className="text-center text-xs text-slate-400">还没有 GitLab 账号</p>}
      </div>
    </PageShell>
  );
}
