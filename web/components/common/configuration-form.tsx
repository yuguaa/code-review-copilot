import { Checkbox, Field, Input } from '@web/components/ui/forms';

import type { ReactNode } from 'react';

export function SecretField({ label, configured, value, onChange, required = false, clearable = false }: {
  label: string; configured?: boolean; value: string | null; onChange: (value: string | null) => void; required?: boolean; clearable?: boolean;
}) {
  return <div className="flex flex-col gap-2">
    <Field label={label} hint={configured ? '已配置，留空保留现有内容。' : undefined}>
      <Input type="password" autoComplete="new-password" value={value ?? ''} required={required} disabled={value === null}
        placeholder={value === null ? '保存时清除' : configured ? '输入新内容以替换' : '请输入'}
        onChange={(event) => onChange(event.target.value)} />
    </Field>
    {clearable && configured && <Checkbox label="清除已保存的内容" checked={value === null} onChange={(checked) => onChange(checked ? null : '')} />}
  </div>;
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <fieldset className="flex min-w-0 flex-col gap-4 border-t pt-5"><legend className="pr-2 text-sm font-semibold">{title}</legend>{description && <p className="text-xs leading-6 text-muted-foreground">{description}</p>}{children}</fieldset>;
}
