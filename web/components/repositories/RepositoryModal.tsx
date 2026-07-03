import { ToolSkillList } from '../ToolSkillList';
import { Button } from '../ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '../ui/forms';
import { Modal } from '../ui/modal';
import type { Account, AIModel, Project, RepositoryForm } from '../../hooks/useRepositoriesPageData';
import type { AgentSkillItem, AgentToolItem } from '../../lib/types';

type RepositoryModalProps = {
  accounts: Account[];
  editingId: string | null;
  form: RepositoryForm;
  modalOpen: boolean;
  models: AIModel[];
  projects: Project[];
  saving: boolean;
  search: string;
  skills: AgentSkillItem[];
  tools: AgentToolItem[];
  closeModal: () => void;
  fetchProjects: () => void;
  pickProject: (project: Project) => void;
  setField: <K extends keyof RepositoryForm>(key: K, value: RepositoryForm[K]) => void;
  setSearch: (value: string) => void;
  submit: () => void;
};

export function RepositoryModal({
  accounts,
  editingId,
  form,
  modalOpen,
  models,
  projects,
  saving,
  search,
  skills,
  tools,
  closeModal,
  fetchProjects,
  pickProject,
  setField,
  setSearch,
  submit,
}: RepositoryModalProps) {
  return (
    <Modal open={modalOpen} title={editingId ? '编辑仓库' : '添加仓库'} onClose={closeModal}>
      {accounts.length === 0 ? (
        <p className="text-xs text-[var(--warning)]">请先到「设置」添加 GitLab 账号</p>
      ) : (
        <div className="space-y-4">
          <Field label="GitLab 账号">
            <Select value={form.gitLabAccountId} onChange={(e) => setField('gitLabAccountId', e.target.value)}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.url}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="选择项目" hint="按名称搜索后从下方点击选中，自动填入项目 ID / 名称 / 路径">
            <div className="flex gap-2">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索项目名…" />
              <Button variant="secondary" onClick={fetchProjects} type="button">
                拉取
              </Button>
            </div>
          </Field>
          {projects.length > 0 && (
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-[var(--r-md)] bg-[var(--surface-card)] p-1 ring-1 ring-[var(--hairline)]">
              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => pickProject(project)}
                  className="block w-full rounded-[var(--r-sm)] px-2 py-1.5 text-left text-xs text-[var(--body)] transition-[background-color] hover:bg-white hover:text-[var(--ink)]"
                >
                  {project.path} <span className="text-[var(--muted-soft)]">#{project.id}</span>
                </button>
              ))}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            <Field label="项目 ID">
              <Input value={form.gitLabProjectId} onChange={(e) => setField('gitLabProjectId', e.target.value)} />
            </Field>
            <Field label="名称">
              <Input value={form.name} onChange={(e) => setField('name', e.target.value)} />
            </Field>
            <Field label="路径">
              <Input value={form.path} onChange={(e) => setField('path', e.target.value)} />
            </Field>
          </div>

          <Field label="仓库默认模型" hint="不选择时自动使用「设置」里的全局默认模型；需要特殊模型时再开启仓库自定义模型">
            <Select value={form.defaultAIModelId} onChange={(e) => setField('defaultAIModelId', e.target.value)}>
              <option value="">使用全局默认模型</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.provider}/{model.modelId}{model.isDefault ? '（默认）' : ''}
                </option>
              ))}
            </Select>
          </Field>

          <Checkbox label="使用仓库自定义模型" checked={form.useCustomModel} onChange={(value) => setField('useCustomModel', value)} />

          {form.useCustomModel && (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="模型 Provider">
                  <Select value={form.customProvider} onChange={(e) => setField('customProvider', e.target.value)}>
                    <option value="openai">openai</option>
                    <option value="anthropic">anthropic</option>
                    <option value="openai-compatible">openai-compatible</option>
                  </Select>
                </Field>
                <Field label="模型 ID">
                  <Input value={form.customModelId} onChange={(e) => setField('customModelId', e.target.value)} placeholder="gpt-4o" />
                </Field>
                <Field label="最大步数">
                  <Input type="number" value={form.customMaxSteps} onChange={(e) => setField('customMaxSteps', Number(e.target.value))} />
                </Field>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field label="模型 API Key">
                  <Input type="password" value={form.customApiKey} onChange={(e) => setField('customApiKey', e.target.value)} />
                </Field>
                <Field label="API Base URL（openai-compatible 必填）">
                  <Input value={form.customApiBaseUrl} onChange={(e) => setField('customApiBaseUrl', e.target.value)} placeholder="https://.../v1" />
                </Field>
              </div>
            </>
          )}

          <Field label="监听分支" hint="逗号分隔，支持通配符，如 main,release-*；留空=全部">
            <Input value={form.watchBranches} onChange={(e) => setField('watchBranches', e.target.value)} />
          </Field>

          <Field label="默认审查提示词（可选）" hint="webhook 首轮审查的额外要求，会追加到内置审查指令之后">
            <Textarea
              rows={3}
              value={form.defaultReviewPrompt}
              onChange={(e) => setField('defaultReviewPrompt', e.target.value)}
              placeholder="例如：重点关注鉴权与数据库事务一致性"
            />
          </Field>

          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {([
                ['autoReview', '开启 Webhook 自动审查'],
                ['enableMrComment', '回写平台评论'],
                ['enableDingtalk', '推送钉钉'],
              ] as const).map(([key, label]) => (
                <Checkbox key={key} label={label} checked={form[key]} onChange={(value) => setField(key, value)} />
              ))}
            </div>
            <p className="text-xs leading-relaxed text-[var(--muted)]">
              审查结论始终保留在会话页面；「回写平台评论」控制是否发布到 GitLab（MR / Commit 评论），「推送钉钉」控制审查完成后是否推送群通知。
            </p>
          </div>

          <div className="space-y-4 rounded-[var(--r-md)] bg-[var(--surface-soft)] p-4">
            <div>
              <h3 className="font-display text-sm text-[var(--ink)]">仓库 Tools / Skills</h3>
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                这里覆盖平台默认能力。关闭工具后，审查与追问都不会再向模型暴露对应 tool。
              </p>
            </div>
            <ToolSkillList
              title="Tools"
              items={tools}
              selected={form.enabledTools}
              onChange={(next) => setField('enabledTools', next)}
              defaultLabel="平台默认"
            />
            <ToolSkillList
              title="Skills"
              items={skills}
              selected={form.enabledSkills}
              onChange={(next) => setField('enabledSkills', next)}
              defaultLabel="平台默认"
            />
          </div>

          {form.enableDingtalk && (
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="钉钉机器人 Webhook">
                <Input
                  value={form.dingtalkWebhook}
                  onChange={(e) => setField('dingtalkWebhook', e.target.value)}
                  placeholder="https://oapi.dingtalk.com/robot/send?access_token=…"
                />
              </Field>
              <Field label="钉钉加签密钥（可选）">
                <Input
                  type="password"
                  value={form.dingtalkSecret}
                  onChange={(e) => setField('dingtalkSecret', e.target.value)}
                  placeholder="SEC…"
                />
              </Field>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-[var(--hairline)] pt-4">
            <Button variant="secondary" onClick={closeModal} type="button" disabled={saving}>
              取消
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? '保存中…' : editingId ? '保存修改' : '添加仓库'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
