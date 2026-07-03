import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import type { AgentSkillItem, AgentToolItem } from '../lib/types';

export type Account = { id: string; url: string };
export type AIModel = { id: string; provider: string; modelId: string; isDefault: boolean };
export type Project = { id: number; name: string; path: string; defaultBranch: string };
export type Repo = {
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
  enabledTools: string[];
  enabledSkills: string[];
};

export const emptyRepositoryForm = {
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
  enabledTools: [] as string[],
  enabledSkills: [] as string[],
};

export type RepositoryForm = typeof emptyRepositoryForm;

export function useRepositoriesPageData() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [models, setModels] = useState<AIModel[]>([]);
  const [tools, setTools] = useState<AgentToolItem[]>([]);
  const [skills, setSkills] = useState<AgentSkillItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ ...emptyRepositoryForm });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const setField = <K extends keyof RepositoryForm>(key: K, value: RepositoryForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const load = useCallback(() => {
    return Promise.all([
      api<{ repositories: Repo[] }>('/api/repositories'),
      api<{ accounts: Account[] }>('/api/settings/gitlab'),
      api<{ models: AIModel[] }>('/api/settings/models'),
      api<{ tools: AgentToolItem[]; skills: AgentSkillItem[] }>('/api/settings/capabilities'),
    ])
      .then(([repositoryResult, accountResult, modelResult, capabilityResult]) => {
        setRepos(repositoryResult.repositories);
        setAccounts(accountResult.accounts);
        setModels(modelResult.models);
        setTools(capabilityResult.tools);
        setSkills(capabilityResult.skills);
        setForm((current) =>
          current.gitLabAccountId || !accountResult.accounts[0]
            ? current
            : { ...current, gitLabAccountId: accountResult.accounts[0].id },
        );
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : '配置加载失败'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const fetchProjects = () => {
    if (!form.gitLabAccountId) {
      toast.error('请先选择 GitLab 账号');
      return;
    }
    api<{ projects: Project[] }>(
      `/api/settings/gitlab/${form.gitLabAccountId}/projects?search=${encodeURIComponent(search)}`,
    )
      .catch(() => ({ projects: [] }))
      .then((data) => {
        setProjects(data.projects);
        if (data.projects.length === 0) toast.message('没有拉到项目');
      });
  };

  const pickProject = (project: Project) => {
    setForm((current) => ({
      ...current,
      gitLabProjectId: String(project.id),
      name: project.name,
      path: project.path,
    }));
    setProjects([]);
  };

  const openAdd = () => {
    setEditingId(null);
    setForm((current) => ({
      ...emptyRepositoryForm,
      gitLabAccountId: current.gitLabAccountId,
      enabledTools: tools.filter((item) => item.defaultEnabled).map((item) => item.key),
      enabledSkills: skills.filter((item) => item.defaultEnabled).map((item) => item.key),
    }));
    setProjects([]);
    setSearch('');
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setEditingId(null);
    setProjects([]);
  };

  const edit = (repo: Repo) => {
    setEditingId(repo.id);
    setForm({
      ...emptyRepositoryForm,
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
      enabledTools: repo.enabledTools,
      enabledSkills: repo.enabledSkills,
    });
    setProjects([]);
    setModalOpen(true);
  };

  const submit = () => {
    if (!form.gitLabAccountId || !form.gitLabProjectId) {
      toast.error('请填写账号与项目');
      return;
    }
    if (form.useCustomModel && (!form.customProvider || !form.customModelId || (!editingId && !form.customApiKey))) {
      toast.error('请填写完整的仓库自定义模型配置');
      return;
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
        setForm({ ...emptyRepositoryForm, gitLabAccountId: form.gitLabAccountId });
        setEditingId(null);
        setModalOpen(false);
        return load();
      })
      .then(() => toast.success(editingId ? '已更新仓库' : '已添加仓库'))
      .catch((e) => toast.error(e instanceof Error ? e.message : editingId ? '更新失败' : '添加失败'))
      .finally(() => setSaving(false));
  };

  const remove = (repo: Repo) => {
    return api(`/api/repositories/${repo.id}`, { method: 'DELETE' })
      .then(load)
      .then(() => toast.success('已删除仓库'))
      .catch((e) => toast.error(e instanceof Error ? e.message : '删除失败'));
  };

  return {
    repos,
    accounts,
    models,
    tools,
    skills,
    projects,
    search,
    form,
    editingId,
    modalOpen,
    saving,
    setField,
    setSearch,
    fetchProjects,
    pickProject,
    openAdd,
    closeModal,
    edit,
    submit,
    remove,
  };
}
