import { createContext, useContext } from 'react';

export type ShellContextValue = {
  collapsed: boolean;
  toggleSidebar: () => void;
};

export const ShellContext = createContext<ShellContextValue>({
  collapsed: false,
  toggleSidebar: () => undefined,
});

export const useShell = () => useContext(ShellContext);
