import type { ReactNode } from 'react';
import { cn } from '@web/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog';

/** 业务弹窗：统一的标题、关闭行为与滚动区域。 */
export function Modal({
  open,
  title,
  children,
  onClose,
  maxWidth = 'sm:max-w-3xl',
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  maxWidth?: string;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className={cn('max-h-[85vh] overflow-y-auto', maxWidth)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
