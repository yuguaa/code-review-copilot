import { Checkbox } from './ui/forms';

export type ToolSkillItem = {
  key: string;
  name: string;
  description: string;
  category?: string;
  mode?: string;
  defaultEnabled: boolean;
  enabled?: boolean;
};

export function ToolSkillList({
  title,
  items,
  selected,
  onChange,
  defaultLabel = '默认启用',
}: {
  title: string;
  items: ToolSkillItem[];
  selected: string[];
  onChange: (next: string[]) => void;
  defaultLabel?: string;
}) {
  const selectedSet = new Set(selected);
  const toggle = (key: string, enabled: boolean) => {
    const next = new Set(selectedSet);
    enabled ? next.add(key) : next.delete(key);
    onChange([...next]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display text-sm text-[var(--ink)]">{title}</h3>
        <span className="caption text-[var(--muted)]">
          {selected.length}/{items.length}
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {items.map((item) => {
          const active = selectedSet.has(item.key);
          return (
            <label
              key={item.key}
              className={[
                'flex cursor-pointer items-start gap-2 rounded-[var(--r-sm)] border px-3 py-2.5 shadow-[var(--shadow-sm)] transition-[background-color,border-color,transform] hover:border-[var(--line-accent)] hover:bg-[var(--surface-hover)] active:scale-[0.98]',
                active ? 'border-[var(--line-accent)] bg-[var(--surface-selected)]' : 'border-[var(--line-default)] bg-[var(--surface-card)]',
              ].join(' ')}
            >
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => toggle(item.key, e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded-[var(--r-xs)] accent-[var(--accent)]"
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold text-[var(--ink)]">{item.name}</span>
                  <span className="line-tag caption rounded-[var(--r-pill)] bg-[var(--surface-card)] px-1.5 py-0.5 text-[var(--muted)]">
                    {item.category ?? item.mode ?? item.key}
                  </span>
                  {item.defaultEnabled && (
                    <span className="line-tag caption rounded-[var(--r-pill)] bg-[var(--brand-cyan)]/18 px-1.5 py-0.5 text-[var(--ink)]">
                      {defaultLabel}
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-[var(--muted)]">{item.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
