import { cn } from '../lib/utils';
import { Badge } from './ui/badge';

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
    if (enabled) next.add(key);
    else next.delete(key);
    onChange([...next]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {selected.length}/{items.length}
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {items.map((item) => {
          const active = selectedSet.has(item.key);
          return (
            <label
              key={item.key}
              className={cn(
                'flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 transition-colors',
                active ? 'border-ring bg-accent' : 'border-border hover:bg-muted/50',
              )}
            >
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => toggle(item.key, event.target.checked)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium">{item.name}</span>
                  <Badge variant="outline" className="text-xs">
                    {item.category ?? item.mode ?? item.key}
                  </Badge>
                  {item.defaultEnabled ? (
                    <Badge variant="secondary" className="text-xs">
                      {defaultLabel}
                    </Badge>
                  ) : null}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{item.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
