import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { AppShell } from '@web/components/layout/app-shell';
import { ResourceState } from '@web/components/common/resource-state';
import { checkAuth } from '@web/lib/api';
import { Login } from '@web/pages/login-page';

const Activities = lazy(() => import('@web/pages/activities').then((module) => ({ default: module.Activities })));
const ReviewDetail = lazy(() => import('@web/pages/review-detail').then((module) => ({ default: module.ReviewDetail })));
const Repositories = lazy(() => import('@web/pages/repositories-page').then((module) => ({ default: module.Repositories })));
const Models = lazy(() => import('@web/pages/models').then((module) => ({ default: module.Models })));
const Connections = lazy(() => import('@web/pages/connections').then((module) => ({ default: module.Connections })));
const Rss = lazy(() => import('@web/pages/rss-page').then((module) => ({ default: module.Rss })));
const SecurityTickets = lazy(() => import('@web/pages/security-tickets-page').then((module) => ({ default: module.SecurityTicketsPage })));
const SecurityTargets = lazy(() => import('@web/pages/security-targets-page').then((module) => ({ default: module.SecurityTargetsPage })));
const SecurityTicketDetail = lazy(() => import('@web/pages/security-ticket-detail-page').then((module) => ({ default: module.SecurityTicketDetailPage })));
const AuthContext = createContext<{ authed: boolean; ready: boolean; refresh: () => Promise<void> }>({ authed: false, ready: false, refresh: () => Promise.resolve() });

export function useAuth() { return useContext(AuthContext); }

function ProtectedShell() {
  const auth = useAuth();
  const location = useLocation();
  if (!auth.ready) return <ResourceState loading />;
  if (!auth.authed) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <AppShell />;
}

export function App() {
  const location = useLocation();
  const [authed, setAuthed] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => checkAuth().then((value) => { setAuthed(value); setReady(true); setError(null); }), []);
  useEffect(() => {
    const expire = () => { setAuthed(false); setReady(true); };
    window.addEventListener('auth-expired', expire);
    void refresh().catch((reason: Error) => setError(reason.message));
    return () => window.removeEventListener('auth-expired', expire);
  }, [refresh]);
  if (error && location.pathname !== '/login') return <ResourceState error={error} retry={() => { void refresh().catch((reason: Error) => setError(reason.message)); }} />;
  return <AuthContext.Provider value={{ authed, ready, refresh }}><Suspense fallback={<ResourceState loading />}><Routes>
    <Route path="/login" element={<Login />} />
    <Route element={<ProtectedShell />}>
      <Route path="/" element={<Activities />} />
      <Route path="/runs/:runId" element={<ReviewDetail />} />
      <Route path="/c/:sessionId" element={<ReviewDetail />} />
      <Route path="/repositories" element={<Repositories />} />
      <Route path="/models" element={<Models />} />
      <Route path="/connections" element={<Connections />} />
      <Route path="/rss" element={<Rss />} />
      <Route path="/security" element={<SecurityTickets />} />
      <Route path="/security/targets" element={<SecurityTargets />} />
      <Route path="/security/tickets/:ticketId" element={<SecurityTicketDetail />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense></AuthContext.Provider>;
}
