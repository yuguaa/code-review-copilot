import { useEffect, useState, createContext, useContext, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { checkAuth } from './lib/api';
import { Login } from './pages/Login';
import { Chat } from './pages/Chat';
import { Settings } from './pages/Settings';
import { Repositories } from './pages/Repositories';

type AuthState = { authed: boolean; ready: boolean; refresh: () => Promise<void> };
const AuthContext = createContext<AuthState>({ authed: false, ready: false, refresh: async () => {} });
export const useAuth = () => useContext(AuthContext);

function RequireAuth({ children }: { children: ReactNode }) {
  const { authed, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="flex h-full items-center justify-center bg-[var(--canvas)] text-sm text-[var(--muted)]">加载中…</div>;
  if (!authed) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
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
        <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
        <Route path="/repositories" element={<RequireAuth><Repositories /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthContext.Provider>
  );
}
