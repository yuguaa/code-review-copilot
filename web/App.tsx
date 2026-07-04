import { lazy, Suspense, useEffect, useState, createContext, useContext, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { checkAuth } from './lib/api';
import { Login } from './pages/Login';

const Chat = lazy(() => import('./pages/Chat').then((module) => ({ default: module.Chat })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((module) => ({ default: module.Dashboard })));
const Settings = lazy(() => import('./pages/Settings').then((module) => ({ default: module.Settings })));
const Repositories = lazy(() => import('./pages/Repositories').then((module) => ({ default: module.Repositories })));

type AuthState = { authed: boolean; ready: boolean; refresh: () => Promise<void> };
const AuthContext = createContext<AuthState>({ authed: false, ready: false, refresh: async () => {} });
export const useAuth = () => useContext(AuthContext);

function PageFallback() {
  return <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">加载中…</div>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { authed, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <PageFallback />;
  if (!authed) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

export function App() {
  const [authed, setAuthed] = useState(false);
  const [ready, setReady] = useState(false);

  const refresh = async () => {
    setAuthed(await checkAuth());
    setReady(true);
  };
  useEffect(() => {
    void refresh();
  }, []);

  return (
    <AuthContext.Provider value={{ authed, ready, refresh }}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth><Chat /></RequireAuth>} />
        <Route path="/c/:sessionId" element={<RequireAuth><Chat /></RequireAuth>} />
        <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
        <Route path="/repositories" element={<RequireAuth><Repositories /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthContext.Provider>
  );
}
