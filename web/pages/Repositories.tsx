import { cn } from '../lib/cn';
import { Button, Card, Checkbox, ColorBlock, Field, Input, Select, Textarea, PageShell, Modal, useConfirm } from '../components/ui';
import { CapabilityList } from '../components/CapabilityList';
import { useRepositoriesPageData } from '../hooks/useRepositoriesPageData';

export function Repositories() {
  const {
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
  } = useRepositoriesPageData();
  const { confirm, element: confirmElement } = useConfirm();
  const webhookUrl = `${location.origin}/api/webhook/gitlab`;

  const confirmRemove = (repo: (typeof repos)[number]) => {
    void confirm({
      title: '删除仓库',
      description: `「${repo.path}」的配置与关联会话记录将被删除，Webhook 触发也会失效。`,
    }).then((ok) => {
      if (!ok) return;
      void remove(repo);
    });
  };

  return (
    <PageShell title="仓库配置">
      <ColorBlock tone="lime" className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="font-display text-2xl">Webhook 接入</h2>
            <p className="text-sm opacity-80">在 GitLab 项目里添加 Webhook，勾选 Merge Request events 和 Push events。</p>
          </div>
          <Button onClick={openAdd} type="button">
            添加仓库
          </Button>
        </div>
        <code className="block break-all rounded-[var(--r-md)] bg-[var(--surface-dark)] px-3 py-2.5 font-mono text-xs text-[var(--brand-mint)]">{webhookUrl}</code>
        <p className="text-xs opacity-70">Secret Token 与对应账号的 Webhook 密钥一致即可验签。</p>
      </ColorBlock>

      <Modal open={modalOpen} title={editingId ? '编辑仓库' : '添加仓库'} onClose={closeModal}>
        {accounts.length === 0 ? (
          <p className="text-xs text-[var(--warning)]">请先到「设置」添加 GitLab 账号</p>
        ) : (
          <div className="space-y-4">
            <Field label="GitLab 账号">
              <Select value={form.gitLabAccountId} onChange={(e) => setField('gitLabAccountId', e.target.value)}>
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
                <Button variant="secondary" onClick={fetchProjects} type="button">
                  拉取
                </Button>
              </div>
            </Field>
            {projects.length > 0 && (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-[var(--r-md)] bg-[var(--surface-card)] p-1 ring-1 ring-[var(--hairline)]">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => pickProject(p)}
                    className="block w-full rounded-[var(--r-sm)] px-2 py-1.5 text-left text-xs text-[var(--body)] transition-[background-color] hover:bg-white hover:text-[var(--ink)]"
                  >
                    {p.path} <span className="text-[var(--muted-soft)]">#{p.id}</span>
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
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.provider}/{m.modelId}{m.isDefault ? '（默认）' : ''}
                  </option>
                ))}
              </Select>
            </Field>

            <Checkbox label="使用仓库自定义模型" checked={form.useCustomModel} onChange={(v) => setField('useCustomModel', v)} />

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
                ] as const).map(([k, label]) => (
                  <Checkbox key={k} label={label} checked={form[k]} onChange={(v) => setField(k, v)} />
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
              <CapabilityList
                title="Tools"
                items={tools}
                selected={form.enabledTools}
                onChange={(next) => setField('enabledTools', next)}
                defaultLabel="平台默认"
              />
              <CapabilityList
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

      <div className="space-y-3">
        {repos.map((r) => (
          <Card key={r.id} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold text-[var(--ink)]">{r.path}</p>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[11px] font-medium',
                    r.autoReview ? 'bg-[var(--success)]/12 text-[var(--success)]' : 'bg-[var(--surface-strong)] text-[var(--muted)]',
                  )}
                >
                  {r.autoReview ? '自动审查' : '手动'}
                </span>
                {r.enableMrComment && <span className="rounded-full bg-[var(--brand-lilac)]/45 px-2 py-0.5 text-[11px] text-[var(--body-strong)]">平台评论</span>}
                {r.enableDingtalk && <span className="rounded-full bg-[var(--brand-cream)] px-2 py-0.5 text-[11px] text-[var(--body-strong)]">钉钉</span>}
              </div>
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                模型 {r.customProvider && r.customModelId ? `${r.customProvider}/${r.customModelId}` : r.defaultAIModel ? `${r.defaultAIModel.provider}/${r.defaultAIModel.modelId}` : '全局默认'} · 监听 {r.watchBranches || '全部'} · Skills {r.enabledSkills.length} · Tools {r.enabledTools.length}
              </p>
            </div>
            <Button variant="secondary" onClick={() => edit(r)}>
              编辑
            </Button>
            <Button variant="danger" onClick={() => confirmRemove(r)}>
              删除
            </Button>
          </Card>
        ))}
        {repos.length === 0 && <p className="text-center text-xs text-[var(--muted)]">还没有配置仓库</p>}
      </div>
      {confirmElement}
    </PageShell>
  );
}
