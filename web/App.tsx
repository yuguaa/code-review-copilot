import { lazy, Suspense, useEffect, useState, createContext, useContext, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { checkAuth } from './lib/api';
import { AppShell } from './components/layout/app-shell';
import { Login } from './pages/Login';

const Chat = lazy(() => import('./pages/Chat').then((module) => ({ default: module.Chat })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((module) => ({ default: module.Dashboard })));
const Help = lazy(() => import('./pages/Help').then((module) => ({ default: module.Help })));
const Settings = lazy(() => import('./pages/Settings').then((module) => ({ default: module.Settings })));
const Rss = lazy(() => import('./pages/Rss').then((module) => ({ default: module.Rss })));
const Repositories = lazy(() => import('./pages/Repositories').then((module) => ({ default: module.Repositories })));

type AuthState = { authed: boolean; ready: boolean; refresh: () => Promise<void> };
const AuthContext = createContext<AuthState>({ authed: false, ready: false, refresh: () => Promise.resolve() });
export const useAuth = () => useContext(AuthContext);

function PageFallback() {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中…</div>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { authed, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <PageFallback />;
  if (!authed) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

function ShellOutlet() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export function App() {
  const [authed, setAuthed] = useState(false);
  const [ready, setReady] = useState(false);

  const refresh = () => checkAuth().then(setAuthed).finally(() => setReady(true));
  useEffect(() => {
    void refresh();
  }, []);

  return (
    <AuthContext.Provider value={{ authed, ready, refresh }}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <RequireAuth>
              <ShellOutlet />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Chat />} />
          <Route path="/c/:sessionId" element={<Chat />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/help" element={<Help />} />
          <Route path="/rss" element={<Rss />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/repositories" element={<Repositories />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthContext.Provider>
  );
}
