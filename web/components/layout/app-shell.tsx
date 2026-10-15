import { useCallback, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { usePanelRef, type PanelImperativeHandle, type PanelSize } from 'react-resizable-panels';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@web/components/ui/resizable';
import { SidebarProvider, useSidebar } from '@web/components/ui/sidebar';
import { AppSidebar } from './app-sidebar';
import { ShellContext } from './shell-context';

const SIDEBAR_WIDTH = 248;
const SIDEBAR_ICON_WIDTH = 48;
const SIDEBAR_MAX_WIDTH = 380;

/**
 * 工作台外壳：可拖拽的会话侧栏 + 主区。
 * 侧栏拖到 48px 即折叠为图标栏，与侧栏内容自身的图标模式保持同步。
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const panelRef = usePanelRef();

  const applyCollapsed = useCallback(
    (next: boolean) => {
      const panel = panelRef.current;
      if (panel) {
        if (next) panel.collapse();
        else panel.expand();
      }
      setCollapsed(next);
    },
    [panelRef],
  );

  const handleSidebarResize = useCallback((size: PanelSize) => {
    setCollapsed(size.inPixels <= SIDEBAR_ICON_WIDTH + 1);
  }, []);

  return (
    <SidebarProvider
      open={!collapsed}
      onOpenChange={(next) => applyCollapsed(!next)}
      className="h-svh min-h-0"
      style={{ '--sidebar-width': `${SIDEBAR_WIDTH}px` } as React.CSSProperties}
    >
      <ShellLayout panelRef={panelRef} onSidebarResize={handleSidebarResize}>
        {children}
      </ShellLayout>
    </SidebarProvider>
  );
}

function ShellLayout({
  children,
  panelRef,
  onSidebarResize,
}: {
  children: ReactNode;
  panelRef: RefObject<PanelImperativeHandle | null>;
  onSidebarResize: (size: PanelSize) => void;
}) {
  const { isMobile, open, toggleSidebar } = useSidebar();
  const shell = useMemo(() => ({ collapsed: !open, toggleSidebar }), [open, toggleSidebar]);

  if (isMobile) {
    return (
      <ShellContext.Provider value={shell}>
        <AppSidebar />
        <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </ShellContext.Provider>
    );
  }

  return (
    <ShellContext.Provider value={shell}>
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel
          id="shell-sidebar"
          panelRef={panelRef}
          collapsible
          collapsedSize={SIDEBAR_ICON_WIDTH}
          minSize={SIDEBAR_WIDTH}
          maxSize={SIDEBAR_MAX_WIDTH}
          defaultSize={SIDEBAR_WIDTH}
          groupResizeBehavior="preserve-pixel-size"
          onResize={onSidebarResize}
          className="min-w-0"
        >
          <AppSidebar />
        </ResizablePanel>
        <ResizablePanelSeparator />
        <ResizablePanel className="min-w-0">
          <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">{children}</main>
        </ResizablePanel>
      </ResizablePanelGroup>
    </ShellContext.Provider>
  );
}

/** 分隔线支持拖拽调整宽度，单击（未拖动）折叠侧栏。 */
function ResizablePanelSeparator() {
  const { toggleSidebar } = useSidebar();
  const pointerDownAt = useMemo(() => ({ x: 0 }), []);

  return (
    <ResizableHandle
      className="z-20 w-px cursor-col-resize bg-border transition-colors after:w-3 hover:bg-primary data-[separator=active]:bg-primary"
      onPointerDown={(event) => {
        pointerDownAt.x = event.clientX;
      }}
      onClick={(event) => {
        if (Math.abs(event.clientX - pointerDownAt.x) > 3) return;
        toggleSidebar();
      }}
    />
  );
}
