import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { CapacitorHttp } from '@capacitor/core';
import { PublicGitHubDashboard, WorkspaceSignIn } from '../../src/components/PublicGitHubDashboard';
import { AnalyzeWorkspace } from '../../src/components/AnalyzeWorkspace';
import AccountDeletionPanel, { parseDeletionResult } from '../../src/components/AccountDeletionPanel';
import { createLoginAttempt } from './auth-flow';
import { createNativeWorkspaceClient } from './workspace-client';

type Client = ReturnType<typeof createNativeWorkspaceClient>;
function base64url(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

export function MobileApp({ apiOrigin }: { apiOrigin: string }) {
  const [client, setClient] = useState<Client | null>(null);
  const [path, setPath] = useState('/dashboard');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [deletionPending, setDeletionPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const session = useRef<Client | null>(null);
  const epoch = useRef(0);
  const login = useRef(createLoginAttempt());

  const clearLocal = useCallback(() => {
    epoch.current++;
    session.current?.close(); session.current = null;
    login.current.finish();
    setClient(null); setPath('/dashboard'); setChecking(false); setDeletionPending(false); setBusy(false);
  }, []);
  const completed = useCallback(() => { clearLocal(); setMessage('Your AgentProof account and associated live data have been deleted.'); }, [clearLocal]);

  async function signIn() {
    if (!apiOrigin.startsWith('https://')) { setMessage('A secure AgentProof server address is required.'); return; }
    if (!login.current.begin()) return;
    setBusy(true); setMessage('');
    const attemptEpoch = epoch.current;
    try {
      const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
      const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
      if (attemptEpoch !== epoch.current) return;
      login.current.setVerifier(verifier);
      await Browser.open({ url: `${apiOrigin}/api/mobile/auth/start?challenge=${challenge}` });
    } catch { if (attemptEpoch === epoch.current) { login.current.finish(); setBusy(false); setMessage('Could not open GitHub sign-in.'); } }
  }

  const checkDeletion = useCallback(async (active: Client) => {
    setChecking(true);
    try {
      const response = await active.runtime.request('/api/mobile/account/deletion');
      if (session.current !== active) return;
      const result = parseDeletionResult(await response.json());
      if (result.status === 'completed') { completed(); return; }
      if (result.status === 'pending') { setDeletionPending(true); setPath('/account/delete'); }
      if (!response.ok || result.status === 'unavailable' || result.status === 'unauthorized') {
        setMessage('Account status could not be verified. Try again.');
        return;
      }
      setChecking(false);
    } catch { if (session.current === active) setMessage('Account status could not be verified. Try again.'); }
  }, [completed]);

  useEffect(() => {
    let disposed = false;
    const listeners: Array<{ remove(): Promise<void> }> = [];
    const keep = (listener: { remove(): Promise<void> }) => { if (disposed) void listener.remove(); else listeners.push(listener); };
    void NativeApp.addListener('appUrlOpen', async ({ url }) => {
      const decision = login.current.callback(url);
      if (decision.kind === 'ignored') return;
      const attemptEpoch = epoch.current;
      await Browser.close().catch(() => undefined);
      if (decision.kind === 'cancelled') { setBusy(false); setMessage('Sign-in was not completed.'); return; }
      try {
        const response = await CapacitorHttp.post({ url: `${apiOrigin}/api/mobile/auth/exchange`, headers: { 'Content-Type': 'application/json' }, data: { code: decision.code, verifier: decision.verifier }, connectTimeout: 10000, readTimeout: 20000 });
        if (disposed || epoch.current !== attemptEpoch) return;
        const value = response.data as { token?: unknown };
        if (response.status !== 200 || typeof value.token !== 'string' || !/^apm_[A-Za-z0-9_-]{43}$/.test(value.token)) throw new Error('Sign-in could not be completed.');
        session.current?.close();
        const next = createNativeWorkspaceClient({
          origin: apiOrigin, token: value.token,
          send: options => CapacitorHttp.request(options),
          navigate: destination => setPath(destination),
          onExpired: reason => { clearLocal(); setMessage(reason === 'logout' ? 'Signed out on this device.' : 'Session expired. Sign in again.'); }
        });
        next.runtime.signIn = signIn;
        next.runtime.connectRepository = async () => {
          setMessage('Repository setup opens in your browser. Use the same GitHub account, then return here and refresh.');
          await Browser.open({ url: `${apiOrigin}/dashboard` });
        };
        session.current = next;
        setClient(next); setPath('/dashboard'); setMessage('');
        void checkDeletion(next);
      } catch { if (!disposed && epoch.current === attemptEpoch) setMessage('Sign-in could not be completed.'); }
      finally { if (!disposed && epoch.current === attemptEpoch) { login.current.finish(); setBusy(false); } }
    }).then(keep);
    void Browser.addListener('browserFinished', () => {
      if (login.current.browserFinished()) setBusy(false);
      if (session.current) setRefresh(value => value + 1);
    }).then(keep);
    return () => { disposed = true; epoch.current++; session.current?.close(); login.current.finish(); for (const listener of listeners) void listener.remove(); };
  }, [apiOrigin]);

  const deletionRequest = useCallback(async (remove: boolean) => {
    if (!client) return { status: 'unauthorized' as const };
    const response = await client.runtime.request('/api/mobile/account/deletion', { method: remove ? 'POST' : 'GET', ...(remove ? { body: JSON.stringify({ confirmation: 'DELETE' }) } : {}) });
    const result = parseDeletionResult(await response.json());
    if (session.current === client && result.status === 'pending') { setDeletionPending(true); setPath('/account/delete'); }
    return result;
  }, [client]);

  function openLink(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as HTMLElement).closest('a');
    const href = anchor?.getAttribute('href');
    if (!href || href.startsWith('#')) return;
    event.preventDefault();
    const url = new URL(href, apiOrigin);
    if (url.origin === apiOrigin && ['/', '/dashboard', '/analyze', '/account/delete'].includes(url.pathname)) {
      if (!deletionPending) setPath(url.pathname === '/' ? '/dashboard' : `${url.pathname}${url.search}`);
    } else if (url.protocol === 'https:') void Browser.open({ url: url.toString() }).catch(() => setMessage('Could not open the link.'));
  }
  const analyzing = path.split('?')[0] === '/analyze';
  return <div className="native-shell" onClickCapture={openLink}>
    {message && <p className="native-message" role="status">{message}</p>}
    {!client ? <WorkspaceSignIn message="" onSignIn={signIn} pending={busy} /> : checking ? <section className="github-dashboard github-session-loading"><p role="status">Checking account…</p>{message && <button className="dashboard-secondary-action" onClick={() => void checkDeletion(client)}>Try again</button>}<button className="dashboard-secondary-action" onClick={() => void client.runtime.request('/api/tenants/auth/session', { method: 'DELETE' }).catch(() => undefined)}>Log out</button></section> : path === '/account/delete' ? <>
      <nav className="native-navigation">{!deletionPending && <button className="dashboard-secondary-action" onClick={() => setPath('/dashboard')}>Back to workspace</button>}<button className="dashboard-secondary-action" onClick={() => void client.runtime.request('/api/tenants/auth/session', { method: 'DELETE' }).catch(() => undefined)}>Log out</button></nav>
      <AccountDeletionPanel request={deletionRequest} signIn={signIn} onCompleted={completed} />
    </> : analyzing ? <>
      <nav className="native-navigation"><button className="dashboard-secondary-action" onClick={() => setPath('/dashboard')}>Back to workspace</button></nav>
      <AnalyzeWorkspace key={path} runtime={client.runtime} launchNonce={new URLSearchParams(path.split('?')[1]).get('launch') ?? undefined} />
    </> : <PublicGitHubDashboard key={refresh} runtime={client.runtime} />}
  </div>;
}
