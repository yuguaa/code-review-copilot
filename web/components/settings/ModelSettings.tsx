import { Button } from '../ui/button';
import { Checkbox, Field, Input, Select } from '../ui/forms';
import { Card, ColorBlock } from '../ui/surface';
import type { AIModel, ModelForm } from '../../hooks/useSettingsPageData';

export function ModelSettingsForm({
  modelForm,
  editing,
  saving,
  onModelChange,
  onSave,
  onCancelEdit,
}: {
  modelForm: ModelForm;
  editing: boolean;
  saving: boolean;
  onModelChange: <K extends keyof ModelForm>(key: K, value: ModelForm[K]) => void;
  onSave: () => void;
  onCancelEdit: () => void;
}) {
  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3 max-sm:flex-col">
        <div>
          <h2 className="font-display text-lg text-[var(--ink)]">全局模型配置</h2>
          {editing ? <p className="mt-1 text-xs text-[var(--muted)]">正在编辑已有模型，API Key 已带回，可直接修改后保存。</p> : null}
        </div>
        {editing ? (
          <Button variant="secondary" onClick={onCancelEdit} disabled={saving}>
            取消编辑
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="模型 Provider">
          <Select value={modelForm.provider} onChange={(event) => onModelChange('provider', event.target.value)}>
            <option value="openai">openai</option>
            <option value="anthropic">anthropic</option>
            <option value="openai-compatible">openai-compatible</option>
          </Select>
        </Field>
        <Field label="模型 ID">
          <Input value={modelForm.modelId} onChange={(event) => onModelChange('modelId', event.target.value)} placeholder="gpt-4o" />
        </Field>
        <Field label="最大步数">
          <Input type="number" value={modelForm.maxSteps} onChange={(event) => onModelChange('maxSteps', Number(event.target.value))} />
        </Field>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="API Key">
          <Input type="password" value={modelForm.apiKey} onChange={(event) => onModelChange('apiKey', event.target.value)} />
        </Field>
        <Field label="API Base URL">
          <Input value={modelForm.apiBaseUrl} onChange={(event) => onModelChange('apiBaseUrl', event.target.value)} placeholder="https://.../v1" />
        </Field>
      </div>
      <Checkbox label="设为默认模型" checked={modelForm.isDefault} onChange={(value) => onModelChange('isDefault', value)} />
      <Button onClick={onSave} disabled={saving}>
        {saving ? '保存中…' : editing ? '保存模型' : '添加模型'}
      </Button>
    </Card>
  );
}

export function ModelList({
  models,
  onSetDefault,
  onActiveChange,
  onEdit,
  onRemove,
}: {
  models: AIModel[];
  onSetDefault: (id: string) => void;
  onActiveChange: (model: AIModel, isActive: boolean) => void;
  onEdit: (model: AIModel) => void;
  onRemove: (model: AIModel) => void;
}) {
  return (
    <div className="line-list">
      {models.map((model) =>
        model.isDefault ? (
          <ColorBlock key={model.id} tone="navy" className="flex items-center gap-3 rounded-none border-0 p-5 shadow-none max-md:flex-col max-md:items-stretch">
            <div className="min-w-0 flex-1">
              <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                <span className="min-w-0 truncate">{model.provider}/{model.modelId}</span>
                <span className="rounded-[var(--r-pill)] border border-[var(--primary)]/24 bg-[var(--state-info-bg)] px-2 py-0.5 text-xs font-medium text-[var(--primary)]">默认</span>
              </p>
              <p className="mt-1 text-[13px] text-[var(--muted)]">
                Key {model.hasApiKey ? '已配置' : '缺失'} · 最大步数 {model.maxSteps} · {model.isActive ? '启用' : '停用'}
              </p>
            </div>
            <div className="flex shrink-0 gap-2 max-md:w-full max-md:flex-col">
              <Button variant="secondary" className="max-md:w-full" onClick={() => onEdit(model)}>
                编辑
              </Button>
              <Button variant="secondary" className="max-md:w-full" onClick={() => onActiveChange(model, false)}>
                停用
              </Button>
              <Button variant="danger" className="max-md:w-full" onClick={() => onRemove(model)}>
                删除
              </Button>
            </div>
          </ColorBlock>
        ) : (
          <Card key={model.id} className="flex items-center gap-3 rounded-none border-0 p-5 shadow-none max-md:flex-col max-md:items-stretch">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-[var(--ink)]">
                {model.provider}/{model.modelId}
              </p>
              <p className="mt-1 text-[13px] text-[var(--muted)]">
                Key {model.hasApiKey ? '已配置' : '缺失'} · 最大步数 {model.maxSteps} · {model.isActive ? '启用' : '停用'}
              </p>
            </div>
            <div className="flex shrink-0 gap-2 border-l border-[var(--line-subtle)] pl-4 max-md:grid max-md:w-full max-md:grid-cols-2 max-md:border-l-0 max-md:border-t max-md:pt-3 max-md:pl-0">
              {model.isActive ? (
                <Button variant="secondary" className="max-md:w-full" onClick={() => onSetDefault(model.id)}>
                  设默认
                </Button>
              ) : null}
              <Button variant="secondary" className="max-md:w-full" onClick={() => onActiveChange(model, !model.isActive)}>
                {model.isActive ? '停用' : '启用'}
              </Button>
              <Button variant="secondary" className="max-md:w-full" onClick={() => onEdit(model)}>
                编辑
              </Button>
              <Button variant="danger" className="max-md:w-full" onClick={() => onRemove(model)}>
                删除
              </Button>
            </div>
          </Card>
        ),
      )}
      {models.length === 0 && <p className="p-6 text-center text-sm text-[var(--muted)]">还没有全局模型配置</p>}
    </div>
  );
}
