import { Button } from '../ui/button';
import { Checkbox, Field, Input, Select } from '../ui/forms';
import { Card, ColorBlock } from '../ui/surface';
import type { AIModel, ModelForm } from '../../hooks/useSettingsPageData';

export function ModelSettingsForm({
  modelForm,
  saving,
  onModelChange,
  onAdd,
}: {
  modelForm: ModelForm;
  saving: boolean;
  onModelChange: <K extends keyof ModelForm>(key: K, value: ModelForm[K]) => void;
  onAdd: () => void;
}) {
  return (
    <Card className="space-y-4">
      <h2 className="font-display text-lg text-[var(--ink)]">全局模型配置</h2>
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
      <Button onClick={onAdd} disabled={saving}>
        {saving ? '保存中…' : '添加模型'}
      </Button>
    </Card>
  );
}

export function ModelList({
  models,
  onSetDefault,
  onActiveChange,
  onRemove,
}: {
  models: AIModel[];
  onSetDefault: (id: string) => void;
  onActiveChange: (model: AIModel, isActive: boolean) => void;
  onRemove: (model: AIModel) => void;
}) {
  return (
    <div className="line-list">
      {models.map((model) =>
        model.isDefault ? (
          <ColorBlock key={model.id} tone="navy" className="flex items-center gap-3 rounded-none border-0 p-5 shadow-none max-md:flex-col max-md:items-stretch">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate text-sm font-semibold">
                {model.provider}/{model.modelId}
                <span className="rounded-full border border-white/25 bg-white/20 px-2 py-0.5 text-[11px]">默认</span>
              </p>
              <p className="text-[11px] opacity-70">
                Key {model.hasApiKey ? '已配置' : '缺失'} · 最大步数 {model.maxSteps} · {model.isActive ? '启用' : '停用'}
              </p>
            </div>
            <div className="flex shrink-0 gap-2 max-md:w-full max-md:flex-col">
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
              <p className="text-[11px] text-[var(--muted)]">
                Key {model.hasApiKey ? '已配置' : '缺失'} · 最大步数 {model.maxSteps} · {model.isActive ? '启用' : '停用'}
              </p>
            </div>
            <div className="flex shrink-0 gap-2 border-l border-[var(--line-subtle)] pl-4 max-md:border-l-0 max-md:border-t max-md:pt-3 max-md:pl-0">
              {model.isActive ? (
                <Button variant="secondary" onClick={() => onSetDefault(model.id)}>
                  设默认
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => onActiveChange(model, !model.isActive)}>
                {model.isActive ? '停用' : '启用'}
              </Button>
              <Button variant="danger" onClick={() => onRemove(model)}>
                删除
              </Button>
            </div>
          </Card>
        ),
      )}
      {models.length === 0 && <p className="text-center text-xs text-[var(--muted)]">还没有全局模型配置</p>}
    </div>
  );
}
