import { useCallback, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog';

type ConfirmOptions = {
  title: string;
  description: string;
  confirmLabel?: string;
};

type ConfirmState = ConfirmOptions & { resolve: (approved: boolean) => void };

/** 危险动作确认：Promise 化的 AlertDialog，调用处直接 await 结果。 */
export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setState({ ...options, resolve });
      }),
    [],
  );

  const settle = useCallback(
    (approved: boolean) => {
      setState((current) => {
        current?.resolve(approved);
        return null;
      });
    },
    [],
  );

  const element = (
    <AlertDialog
      open={Boolean(state)}
      onOpenChange={(next) => {
        if (!next) settle(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{state?.title ?? ''}</AlertDialogTitle>
          <AlertDialogDescription>{state?.description ?? ''}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>取消</AlertDialogCancel>
          <AlertDialogAction onClick={() => settle(true)}>{state?.confirmLabel ?? '删除'}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, element };
}
