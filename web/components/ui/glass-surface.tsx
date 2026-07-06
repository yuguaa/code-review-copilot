import type { CSSProperties, ReactNode } from 'react';
import LiquidGlass from 'liquid-glass-react';
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
  radius = 12,
  interactive = false,
  style,
  onClick,
}: GlassSurfaceProps) {
  return (
    <LiquidGlass
      className={cn(
        'glass-surface relative overflow-hidden border border-[var(--line-default)] shadow-[var(--shadow-md)]',
        interactive && 'transition-transform active:translate-y-px active:scale-[0.99]',
        className,
      )}
      displacementScale={interactive ? 54 : 38}
      blurAmount={0.08}
      saturation={128}
      aberrationIntensity={interactive ? 1.8 : 1.15}
      elasticity={interactive ? 0.22 : 0.08}
      cornerRadius={radius}
      padding={padding}
      overLight
      mode="standard"
      style={style}
      onClick={onClick}
    >
      <div className={cn('relative z-[1]', contentClassName)}>{children}</div>
    </LiquidGlass>
  );
}
