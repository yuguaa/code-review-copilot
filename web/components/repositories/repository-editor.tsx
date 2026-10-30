import { useEffect, useRef, useState } from "react";
import { SearchIcon } from "lucide-react";
import { toast } from "sonner";

import { FormSection, SecretField } from "@web/components/common/configuration-form";
import { ActionError } from "@web/components/common/resource-state";
import { Button } from "@web/components/ui/button";
import { Checkbox, Field, FieldGroup, Input, Select, Textarea } from "@web/components/ui/forms";
import { Modal } from "@web/components/ui/modal";
import { useAction, useResource } from "@web/hooks/use-resource";
import { api } from "@web/lib/api";

import type { AIModelSummary, DingtalkRobot, GitLabAccount, Repository } from "@web/lib/types";

type Project = { id: number; name: string; path: string; defaultBranch: string };

export function RepositoryEditor({ repository, accounts, models, close, saved }: {
  repository: Repository | null; accounts: GitLabAccount[]; models: AIModelSummary[]; close: () => void; saved: () => Promise<unknown>;
}) {
  const [form, setForm] = useState({
    gitLabAccountId: repository?.gitLabAccountId ?? "", gitLabProjectId: repository ? String(repository.gitLabProjectId) : "",
    name: repository?.name ?? "", path: repository?.path ?? "", watchBranches: repository?.watchBranches ?? "main",
    isActive: repository?.isActive ?? true, autoReview: repository?.autoReview ?? true, defaultAIModelId: repository?.defaultAIModelId ?? "",
    useCustomModel: Boolean(repository?.customModelId || repository?.customProvider || repository?.hasCustomApiKey),
    customProvider: repository?.customProvider ?? "openai", customModelId: repository?.customModelId ?? "",
    customApiBaseUrl: repository?.customApiBaseUrl ?? "", customApiKey: "", customMaxSteps: repository?.customMaxSteps ?? 16,
    defaultReviewPrompt: repository?.defaultReviewPrompt ?? "", ocrConcurrency: repository?.ocrConcurrency ?? 2,
    ocrTimeoutMinutes: repository?.ocrTimeoutMinutes ?? 10, ocrMaxTokensBudget: repository?.ocrMaxTokensBudget ?? 2_000_000,
    enableMrComment: repository?.enableMrComment ?? false, enableDingtalk: repository?.enableDingtalk ?? false,
    dingtalkRobotId: (repository?.dingtalkRobotId ?? null) as string | null,
  });
  const robots = useResource<{ robots: DingtalkRobot[] }>("/api/settings/dingtalk");
  const selectedRobot = robots.data?.robots.find((robot) => robot.id === form.dingtalkRobotId);
  const robotValid = Boolean(selectedRobot?.enabled && selectedRobot.isConfigured);
  const [search, setSearch] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [searched, setSearched] = useState(false);
  const searchController = useRef<AbortController | null>(null);
  useEffect(() => () => searchController.current?.abort(), []);
  const action = useAction();
  const update = <K extends keyof typeof form>(key: K, value: typeof form[K]) => setForm((current) => ({ ...current, [key]: value }));
  const searchProjects = () => action.execute("search", () => {
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    return api<{ projects: Project[] }>(`/api/settings/gitlab/${form.gitLabAccountId}/projects?${new URLSearchParams({ search })}`, { signal: controller.signal })
      .then((result) => { setProjects(result.projects); setSearched(true); });
  });
  const submit = () => action.execute("save", () => {
    if (form.enableDingtalk && !robotValid) throw new Error("请选择已启用且配置完整的钉钉连接");
    const { useCustomModel, ...values } = form;
    return api(repository ? `/api/repositories/${repository.id}` : "/api/repositories", { method: repository ? "PATCH" : "POST", body: JSON.stringify({
      ...values, gitLabProjectId: Number(form.gitLabProjectId), defaultAIModelId: form.defaultAIModelId || null,
      customProvider: useCustomModel ? form.customProvider : null, customModelId: useCustomModel ? form.customModelId : null,
      customApiBaseUrl: useCustomModel ? form.customApiBaseUrl.trim() || null : null, customApiKey: useCustomModel ? form.customApiKey : null,
      customMaxSteps: useCustomModel ? form.customMaxSteps : null,
    }) }).then(() => { toast.success("仓库配置已保存"); close(); return saved(); });
  });
  return <Modal open title={repository ? `编辑 ${repository.name}` : "添加仓库"} onClose={() => !action.pending && close()} maxWidth="sm:max-w-2xl">
    <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="flex flex-col gap-7">
      <ActionError error={action.error} />
      <FieldGroup>
        <Field label="GitLab 账号"><Select required value={form.gitLabAccountId} onChange={(event) => {
          searchController.current?.abort(); update("gitLabAccountId", event.target.value); setProjects([]); setSearched(false);
        }}><option value="">请选择账号</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.url}</option>)}</Select></Field>
        {!repository && <Field label="搜索 GitLab 项目">
          <div className="flex gap-2"><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="项目名称或路径" />
            <Button variant="outline" aria-label="搜索项目" disabled={!form.gitLabAccountId || Boolean(action.pending)} onClick={searchProjects}><SearchIcon />搜索</Button>
          </div>
          {projects.length > 0 && <Select aria-label="选择 GitLab 项目" value="" onChange={(event) => {
            const project = projects.find((item) => String(item.id) === event.target.value);
            if (project) setForm((current) => ({ ...current, gitLabProjectId: String(project.id), name: project.name, path: project.path, watchBranches: project.defaultBranch || current.watchBranches }));
          }}><option value="">从搜索结果选择</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.path}</option>)}</Select>}
          {searched && projects.length === 0 && <span className="text-xs text-muted-foreground">没有找到项目</span>}
        </Field>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="仓库名称"><Input required value={form.name} onChange={(event) => update("name", event.target.value)} /></Field>
          <Field label="Project ID"><Input required type="number" min={1} value={form.gitLabProjectId} onChange={(event) => update("gitLabProjectId", event.target.value)} /></Field>
        </div>
        <Field label="项目路径"><Input required value={form.path} placeholder="namespace/project" onChange={(event) => update("path", event.target.value)} /></Field>
        <Field label="监听分支" hint="使用逗号分隔，支持通配符。"><Input value={form.watchBranches} onChange={(event) => update("watchBranches", event.target.value)} /></Field>
        <Checkbox label="启用仓库" checked={form.isActive} onChange={(value) => update("isActive", value)} />
        <Checkbox label="收到变更事件后自动审查" checked={form.autoReview} onChange={(value) => update("autoReview", value)} />
      </FieldGroup>
      <FormSection title="OCR 审查参数"><FieldGroup>
        <Field label="审查背景" hint="平台默认会附加 Token 使用约束；项目专项规则仍由仓库维护。"><Textarea value={form.defaultReviewPrompt} onChange={(event) => update("defaultReviewPrompt", event.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="并发任务数"><Input type="number" min={1} max={16} required value={form.ocrConcurrency} onChange={(event) => update("ocrConcurrency", Number(event.target.value))} /></Field>
          <Field label="任务超时（分钟）"><Input type="number" min={1} max={120} required value={form.ocrTimeoutMinutes} onChange={(event) => update("ocrTimeoutMinutes", Number(event.target.value))} /></Field>
          <Field label="Token 预算" hint="0 表示不限制。"><Input type="number" min={0} required value={form.ocrMaxTokensBudget} onChange={(event) => update("ocrMaxTokensBudget", Number(event.target.value))} /></Field>
        </div>
      </FieldGroup></FormSection>
      <FormSection title="模型"><FieldGroup>
        <Field label="默认模型"><Select value={form.defaultAIModelId} onChange={(event) => update("defaultAIModelId", event.target.value)}><option value="">使用全局默认模型</option>
          {models.map((model) => <option key={model.id} value={model.id} disabled={!model.isActive}>{model.provider}/{model.modelId}{model.isActive ? "" : "（已停用）"} · {model.id.slice(-6)}</option>)}
        </Select></Field>
        <Checkbox label="为此仓库配置独立模型" checked={form.useCustomModel} onChange={(value) => update("useCustomModel", value)} />
        {form.useCustomModel && <>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Provider"><Select value={form.customProvider} onChange={(event) => update("customProvider", event.target.value)}>
            <option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="openai-compatible">OpenAI Compatible</option>
          </Select></Field><Field label="Model ID"><Input required value={form.customModelId} onChange={(event) => update("customModelId", event.target.value)} /></Field></div>
          <Field label="接口地址"><Input type="url" value={form.customApiBaseUrl} onChange={(event) => update("customApiBaseUrl", event.target.value)} /></Field>
          <SecretField label="API Key" configured={repository?.hasCustomApiKey} value={form.customApiKey} required={!repository?.hasCustomApiKey} onChange={(value) => update("customApiKey", value ?? "")} />
          <Field label="对话最大步骤"><Input type="number" required min={1} max={100} value={form.customMaxSteps} onChange={(event) => update("customMaxSteps", Number(event.target.value))} /></Field>
        </>}
      </FieldGroup></FormSection>
      <FormSection title="发布渠道"><FieldGroup>
        <Checkbox label="自动发布到 GitLab" checked={form.enableMrComment} onChange={(value) => update("enableMrComment", value)} />
        <Checkbox label="发送钉钉通知" checked={form.enableDingtalk} onChange={(value) => update("enableDingtalk", value)} />
        <Field label="钉钉连接" error={robots.error} hint={robots.loading ? "正在加载连接…" : "支持 Webhook 或 DWS CLI；CLI 必须已完成授权。"}>
          <Select required={form.enableDingtalk} disabled={robots.loading || Boolean(robots.error)} value={form.dingtalkRobotId ?? ""} onChange={(event) => update("dingtalkRobotId", event.target.value || null)}>
            <option value="">请选择机器人</option>
            {form.dingtalkRobotId && robots.data && !selectedRobot && <option value={form.dingtalkRobotId} disabled>原关联机器人不可用</option>}
            {robots.data?.robots.map((robot) => <option key={robot.id} value={robot.id} disabled={!robot.enabled || !robot.isConfigured}>{robot.name} · {robot.transport === 'cli' ? 'CLI' : 'Webhook'}{!robot.enabled ? "（已停用）" : !robot.isConfigured ? "（配置不完整）" : ""}</option>)}
          </Select>
        </Field>
      </FieldGroup></FormSection>
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={Boolean(action.pending)} onClick={close}>取消</Button>
        <Button type="submit" disabled={Boolean(action.pending) || (form.enableDingtalk && !robotValid)}>{action.pending === "save" ? "正在保存…" : "保存配置"}</Button>
      </div>
    </form>
  </Modal>;
}
