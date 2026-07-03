import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComposerCommand } from './composer-types';

export function useComposerCommands(commands: ComposerCommand[]) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const hasCommand = commands.some((command) => !command.disabled);
  const openRef = useRef(false);
  const selectableCountRef = useRef(0);

  const availableCommands = useMemo(
    () =>
      commands.filter((command) => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return true;
        return `${command.title} ${command.description}`.toLowerCase().includes(normalized);
      }),
    [commands, query],
  );

  const selectableCommands = useMemo(
    () => availableCommands.filter((command) => !command.disabled),
    [availableCommands],
  );

  const activeCommand = selectableCommands[selectedIndex] ?? selectableCommands[0];

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    selectableCountRef.current = selectableCommands.length;
  }, [selectableCommands.length]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (selectedIndex > selectableCommands.length - 1) {
      setSelectedIndex(Math.max(0, selectableCommands.length - 1));
    }
  }, [selectableCommands.length, selectedIndex]);

  const moveSelection = useCallback((direction: 1 | -1) => {
    setSelectedIndex((current) => {
      const count = selectableCountRef.current;
      if (count <= 1) return 0;
      return (current + direction + count) % count;
    });
  }, []);

  const reset = useCallback(() => {
    setQuery('');
    setSelectedIndex(0);
    setOpen(false);
  }, []);

  return {
    activeCommand,
    availableCommands,
    hasCommand,
    moveSelection,
    open,
    openRef,
    reset,
    setOpen,
    setQuery,
  };
}
