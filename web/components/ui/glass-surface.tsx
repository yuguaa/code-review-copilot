import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../lib/cn';

type GlassSurfaceProps = {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  padding?: string;
  radius?: number;
  interactive?: boolean;
  style?: CSSProperties;
  onClick?: () => void;
};

export function GlassSurface({
  children,
  className,
  contentClassName,
  padding,
  radius = 6,
  interactive = false,
  style,
  onClick,
}: GlassSurfaceProps) {
  return (
    <div
      className={cn(
        'glass-surface relative overflow-hidden',
        interactive && 'transition-transform active:translate-y-px active:scale-[0.99]',
        className,
      )}
      style={{ borderRadius: radius, padding, ...style }}
      onClick={onClick}
    >
      <div className={cn('relative z-[1]', contentClassName)}>{children}</div>
    </div>
  );
}
