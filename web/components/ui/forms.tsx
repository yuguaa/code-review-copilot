import type { ComponentProps, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { cn } from '@web/lib/utils';
import { Checkbox as CheckboxPrimitive } from './checkbox';
import { Input as InputPrimitive } from './input';
import { Textarea as TextareaPrimitive } from './textarea';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <InputPrimitive {...props} />;
}

export function Textarea(props: ComponentProps<'textarea'>) {
  return <TextareaPrimitive {...props} className={cn('min-h-24', props.className)} />;
}

const SELECT_CLASS =
  'h-8 w-full min-w-0 cursor-pointer rounded-md border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

/** 原生下拉：配置项数量有限，直接用 select 保持表单语义与键盘行为。 */
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(SELECT_CLASS, props.className)} />;
}

export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string | null;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="block text-xs font-medium">{label}</span>
      {children}
      {error ? (
        <span className="block text-xs text-destructive">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export function FieldGroup({ children }: { children: ReactNode }) {
  return <div data-slot="field-group" className="flex flex-col gap-4">{children}</div>;
}

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <CheckboxPrimitive checked={checked} onCheckedChange={(value) => onChange(Boolean(value))} />
      {label}
    </label>
  );
}
