import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import type { AgentSkillItem, AgentToolItem } from '../lib/types';

export type Account = {
  id: string;
  url: string;
  isActive: boolean;
  hasAccessToken: boolean;
  hasWebhookSecret: boolean;
};

export type AIModel = {
  id: string;
  provider: string;
  modelId: string;
  apiBaseUrl: string | null;
  maxSteps: number;
  isDefault: boolean;
  isActive: boolean;
  hasApiKey: boolean;
};

export type Stats = {
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

export type ModelForm = typeof emptyModelForm;

export function useSettingsPageData() {
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
  const [savingToolSkills, setSavingToolSkills] = useState(false);

  const load = useCallback(() => {
    return Promise.all([
      api<{ accounts: Account[] }>('/api/settings/gitlab'),
      api<{ models: AIModel[] }>('/api/settings/models'),
      api<{ stats: Stats | null }>('/api/settings/stats'),
      api<{ notification: NotificationSetting }>('/api/settings/notification'),
      api<{ tools: AgentToolItem[]; skills: AgentSkillItem[] }>('/api/settings/tool-skills'),
    ])
      .then(([gitlab, ai, overview, notice, toolSkillResult]) => {
        setAccounts(gitlab.accounts);
        setModels(ai.models);
        setStats(overview.stats);
        setTools(toolSkillResult.tools);
        setSkills(toolSkillResult.skills);
        setEnabledTools(toolSkillResult.tools.filter((item) => item.defaultEnabled).map((item) => item.key));
        setEnabledSkills(toolSkillResult.skills.filter((item) => item.defaultEnabled).map((item) => item.key));
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

  const setModel = <K extends keyof typeof modelForm>(key: K, value: (typeof modelForm)[K]) => {
    setModelForm((current) => ({ ...current, [key]: value }));
  };

  const add = () => {
    if (!url || !accessToken) {
      toast.error('请填写实例地址与访问令牌');
      return;
    }
    setSaving(true);
    api('/api/settings/gitlab', {
      method: 'POST',
      body: JSON.stringify({ url, accessToken, webhookSecret: webhookSecret || null }),
    })
      .then(() => {
        setAccessToken('');
        setWebhookSecret('');
        return load();
      })
      .then(() => toast.success('已添加 GitLab 账号'))
      .catch((e) => toast.error(e instanceof Error ? e.message : '添加失败'))
      .finally(() => setSaving(false));
  };

  const test = (id: string) => {
    api<{ ok: boolean }>(`/api/settings/gitlab/${id}/test`, { method: 'POST' })
      .catch(() => ({ ok: false }))
      .then((data) => {
        data.ok ? toast.success('连接正常') : toast.error('连接失败，请检查地址与令牌');
      });
  };

  const remove = (account: Account) => {
    return api(`/api/settings/gitlab/${account.id}`, { method: 'DELETE' })
      .then(load)
      .then(() => toast.success('已删除账号'))
      .catch((e) => toast.error(e instanceof Error ? e.message : '删除失败'));
  };

  const addModel = () => {
    if (!modelForm.provider || !modelForm.modelId || !modelForm.apiKey) {
      toast.error('请填写模型 Provider、模型 ID 与 API Key');
      return;
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
    return api(`/api/settings/models/${model.id}`, { method: 'DELETE' })
      .then(load)
      .then(() => toast.success('已删除模型'))
      .catch((e) => toast.error(e instanceof Error ? e.message : '删除失败'));
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

  const saveToolSkills = () => {
    setSavingToolSkills(true);
    api('/api/settings/tool-skills', {
      method: 'PATCH',
      body: JSON.stringify({
        tools: tools.map((item) => ({ key: item.key, defaultEnabled: enabledTools.includes(item.key), isActive: item.isActive ?? true })),
        skills: skills.map((item) => ({ key: item.key, defaultEnabled: enabledSkills.includes(item.key), isActive: item.isActive ?? true })),
      }),
    })
      .then(load)
      .then(() => toast.success('已保存 Tools / Skills 默认配置'))
      .catch((e) => toast.error(e instanceof Error ? e.message : '保存失败'))
      .finally(() => setSavingToolSkills(false));
  };

  return {
    accounts,
    models,
    stats,
    tools,
    skills,
    enabledTools,
    enabledSkills,
    notification,
    url,
    accessToken,
    webhookSecret,
    modelForm,
    saving,
    savingModel,
    savingNotification,
    savingToolSkills,
    setEnabledTools,
    setEnabledSkills,
    setNotification,
    setUrl,
    setAccessToken,
    setWebhookSecret,
    setModel,
    add,
    test,
    remove,
    addModel,
    setDefaultModel,
    removeModel,
    saveNotification,
    saveToolSkills,
  };
}
