import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { Button, Card, Checkbox, ColorBlock, Field, Input, PageShell, Select, useConfirm } from '../components/ui';
import { CapabilityList } from '../components/CapabilityList';
import type { AgentSkillItem, AgentToolItem } from '../lib/types';

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

type NotificationSetting = {
  dingtalkEnabled: boolean;
  dingtalkWebhookUrl: string | null;
  hasDingtalkSecret: boolean;
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
  const [tools, setTools] = useState<AgentToolItem[]>([]);
  const [skills, setSkills] = useState<AgentSkillItem[]>([]);
  const [enabledTools, setEnabledTools] = useState<string[]>([]);
  const [enabledSkills, setEnabledSkills] = useState<string[]>([]);
  const [notification, setNotification] = useState({
    dingtalkEnabled: true,
    dingtalkWebhookUrl: '',
    dingtalkSecret: '',
  });
  const [url, setUrl] = useState('https://gitlab.com');
  const [accessToken, setAccessToken] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [modelForm, setModelForm] = useState({ ...emptyModelForm });
  const [saving, setSaving] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [savingNotification, setSavingNotification] = useState(false);
  const [savingCapabilities, setSavingCapabilities] = useState(false);
  const { confirm, element: confirmElement } = useConfirm();

  const load = useCallback(() => {
    return Promise.all([
      api<{ accounts: Account[] }>('/api/settings/gitlab'),
      api<{ models: AIModel[] }>('/api/settings/models'),
      api<{ stats: Stats | null }>('/api/settings/stats'),
      api<{ notification: NotificationSetting }>('/api/settings/notification'),
      api<{ tools: AgentToolItem[]; skills: AgentSkillItem[] }>('/api/settings/capabilities'),
    ])
      .then(([gitlab, ai, overview, notice, capabilityResult]) => {
        setAccounts(gitlab.accounts);
        setModels(ai.models);
        setStats(overview.stats);
        setTools(capabilityResult.tools);
        setSkills(capabilityResult.skills);
        setEnabledTools(capabilityResult.tools.filter((item) => item.defaultEnabled).map((item) => item.key));
        setEnabledSkills(capabilityResult.skills.filter((item) => item.defaultEnabled).map((item) => item.key));
        setNotification((current) => ({
          dingtalkEnabled: notice.notification.dingtalkEnabled,
          dingtalkWebhookUrl: notice.notification.dingtalkWebhookUrl ?? '',
          dingtalkSecret: current.dingtalkSecret,
        }));
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : '设置加载失败'));
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

  const remove = (account: Account) => {
    void confirm({
      title: '删除 GitLab 账号',
      description: `「${account.url}」的凭证将被删除，关联仓库的 Webhook 验签与 API 调用会随之失效。`,
    }).then((ok) => {
      if (!ok) return;
      api(`/api/settings/gitlab/${account.id}`, { method: 'DELETE' })
        .then(load)
        .then(() => toast.success('已删除账号'))
        .catch((e) => toast.error(e instanceof Error ? e.message : '删除失败'));
    });
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

  const removeModel = (model: AIModel) => {
    void confirm({
      title: '删除全局模型',
      description: `「${model.provider}/${model.modelId}」将被删除，使用它的仓库会回退到默认模型。`,
    }).then((ok) => {
      if (!ok) return;
      api(`/api/settings/models/${model.id}`, { method: 'DELETE' })
        .then(load)
        .then(() => toast.success('已删除模型'))
        .catch((e) => toast.error(e instanceof Error ? e.message : '删除失败'));
    });
  };

  const saveNotification = () => {
    setSavingNotification(true);
    api('/api/settings/notification', {
      method: 'PATCH',
      body: JSON.stringify(notification),
    })
      .then(load)
      .then(() => {
        setNotification((current) => ({ ...current, dingtalkSecret: '' }));
        toast.success('已保存全局钉钉配置');
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : '保存失败'))
      .finally(() => setSavingNotification(false));
  };

  const saveCapabilities = () => {
    setSavingCapabilities(true);
    api('/api/settings/capabilities', {
      method: 'PATCH',
      body: JSON.stringify({
        tools: tools.map((item) => ({ key: item.key, defaultEnabled: enabledTools.includes(item.key), isActive: item.isActive ?? true })),
        skills: skills.map((item) => ({ key: item.key, defaultEnabled: enabledSkills.includes(item.key), isActive: item.isActive ?? true })),
      }),
    })
      .then(load)
      .then(() => toast.success('已保存 Tools / Skills 默认配置'))
      .catch((e) => toast.error(e instanceof Error ? e.message : '保存失败'))
      .finally(() => setSavingCapabilities(false));
  };

  return (
    <PageShell title="设置">
      {stats && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {([
            ['仓库', `${stats.activeRepositoryCount}/${stats.repositoryCount}`, '启用 / 总数', 'pink'],
            ['模型', String(stats.modelCount), '可用全局模型', 'lavender'],
            ['会话', String(stats.sessionCount), `审查 ${stats.reviewSessionCount} · 对话 ${stats.chatSessionCount}`, 'peach'],
            ['消息', String(stats.messageCount), stats.latestSessionAt ? `最近 ${new Date(stats.latestSessionAt).toLocaleString()}` : '暂无会话', 'cream'],
          ] as const).map(([label, value, hint, tone]) => (
            <ColorBlock key={label} tone={tone === 'lavender' ? 'lilac' : tone === 'peach' ? 'mint' : tone} className="space-y-1 p-5">
              <p className="eyebrow opacity-70">{label}</p>
              <p className="font-display text-3xl tabular-nums">{value}</p>
              <p className="caption truncate opacity-70">{hint}</p>
            </ColorBlock>
          ))}
        </div>
      )}

      <Card className="space-y-4">
        <h2 className="font-display text-lg text-[var(--ink)]">Tools / Skills 管理</h2>
        <p className="text-sm leading-relaxed text-[var(--muted)]">
          这里控制平台默认启用能力；仓库配置里可以再覆盖。`brooks-sweep` 默认关闭，因为它是修复模式，本平台目前不授予写文件工具。
        </p>
        <CapabilityList title="Tools 默认启用" items={tools} selected={enabledTools} onChange={setEnabledTools} />
        <CapabilityList title="Skills 默认启用" items={skills} selected={enabledSkills} onChange={setEnabledSkills} />
        <Button onClick={saveCapabilities} disabled={savingCapabilities}>
          {savingCapabilities ? '保存中…' : '保存 Tools / Skills'}
        </Button>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-display text-lg text-[var(--ink)]">全局钉钉配置</h2>
        <Checkbox
          label="开启全局钉钉推送"
          checked={notification.dingtalkEnabled}
          onChange={(v) => setNotification((current) => ({ ...current, dingtalkEnabled: v }))}
        />
        <Field label="钉钉机器人 Webhook">
          <Input
            value={notification.dingtalkWebhookUrl}
            onChange={(e) => setNotification((current) => ({ ...current, dingtalkWebhookUrl: e.target.value }))}
            placeholder="https://oapi.dingtalk.com/robot/send?access_token=..."
          />
        </Field>
        <Field label="钉钉加签密钥" hint="留空不会覆盖已有密钥">
          <Input
            type="password"
            value={notification.dingtalkSecret}
            onChange={(e) => setNotification((current) => ({ ...current, dingtalkSecret: e.target.value }))}
            placeholder="SEC..."
          />
        </Field>
        <Button onClick={saveNotification} disabled={savingNotification}>
          {savingNotification ? '保存中…' : '保存钉钉配置'}
        </Button>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-display text-lg text-[var(--ink)]">全局模型配置</h2>
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
        <Checkbox label="设为默认模型" checked={modelForm.isDefault} onChange={(v) => setModel('isDefault', v)} />
        <Button onClick={addModel} disabled={savingModel}>
          {savingModel ? '保存中…' : '添加模型'}
        </Button>
      </Card>

      <div className="space-y-3">
        {models.map((m) =>
          m.isDefault ? (
            <ColorBlock key={m.id} tone="navy" className="flex items-center gap-3 p-5">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-semibold">
                  {m.provider}/{m.modelId}
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px]">默认</span>
                </p>
                <p className="text-[11px] opacity-70">
                  Key {m.hasApiKey ? '已配置' : '缺失'} · 最大步数 {m.maxSteps} · {m.isActive ? '启用' : '停用'}
                </p>
              </div>
              <Button variant="danger" onClick={() => removeModel(m)}>
                删除
              </Button>
            </ColorBlock>
          ) : (
            <Card key={m.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-[var(--ink)]">
                  {m.provider}/{m.modelId}
                </p>
                <p className="text-[11px] text-[var(--muted)]">
                  Key {m.hasApiKey ? '已配置' : '缺失'} · 最大步数 {m.maxSteps} · {m.isActive ? '启用' : '停用'}
                </p>
              </div>
              <Button variant="secondary" onClick={() => setDefaultModel(m.id)}>
                设默认
              </Button>
              <Button variant="danger" onClick={() => removeModel(m)}>
                删除
              </Button>
            </Card>
          ),
        )}
        {models.length === 0 && <p className="text-center text-xs text-[var(--muted)]">还没有全局模型配置</p>}
      </div>

      <Card className="space-y-4">
        <h2 className="font-display text-lg text-[var(--ink)]">添加 GitLab 账号</h2>
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
              <p className="truncate text-sm text-[var(--ink)]">{a.url}</p>
              <p className="text-[11px] text-[var(--muted)]">
                令牌 {a.hasAccessToken ? '已配置' : '缺失'} · Webhook 密钥 {a.hasWebhookSecret ? '已配置' : '未配置'}
              </p>
            </div>
            <Button variant="secondary" onClick={() => test(a.id)}>
              测试连接
            </Button>
            <Button variant="danger" onClick={() => remove(a)}>
              删除
            </Button>
          </Card>
        ))}
        {accounts.length === 0 && <p className="text-center text-xs text-[var(--muted)]">还没有 GitLab 账号</p>}
      </div>
      {confirmElement}
    </PageShell>
  );
}
