import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App as NativeApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { CapacitorHttp } from '@capacitor/core';
import { createLoginAttempt, endLocalSession } from './auth-flow';
import './style.css';

type Repository = { repositoryId?: number; repositoryFullName: string; repositoryPrivate?: boolean };
type Report = { id: string; repositoryId?: number; pullRequestNumber?: number; priority: string; createdAt: string; freshness?: string; copyEligible?: boolean; availability?: string; verificationOutcome?: string };
type Detail = { report?: { summary?: { overview?: string; priority?: string }; requirements?: Array<{ requirementId: string; requirementText?: string; status: string; gaps: string[] }>; testing?: { ciStatus: string; lintStatus: string; typecheckStatus: string } }; copyEligible?: boolean; freshness?: string; availability?: string; verificationOutcome?: string; pullRequestNumber?: number };
const API = (import.meta.env.VITE_AGENTPROOF_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const loginAttempt = createLoginAttempt();
function base64url(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function api<T>(path: string, token: string, method = 'GET'): Promise<T> {
  const response = await CapacitorHttp.request({ url: `${API}${path}`, method, headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-store' }, connectTimeout: 10000, readTimeout: 20000 });
  if (response.status < 200 || response.status >= 300) throw new Error(response.status === 401 ? 'Session expired. Sign in again.' : `Request failed (${response.status}).`);
  return response.data as T;
}
function App() {
  const [token, setToken] = useState<string | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [selected, setSelected] = useState<Report | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!token) return; void Promise.all([
    api<{ repositories: Repository[] }>('/api/mobile/repositories', token),
    api<{ reports: Report[] }>('/api/mobile/reports', token)
  ]).then(([repos, result]) => { setRepositories(repos.repositories); setReports(result.reports); setMessage(''); }).catch(error => setMessage(String(error.message))); }, [token]);
  useEffect(() => {
    let appListener: { remove(): Promise<void> } | undefined;
    let browserListener: { remove(): Promise<void> } | undefined;
    let disposed = false;
    void NativeApp.addListener('appUrlOpen', async ({ url }) => {
    const decision = loginAttempt.callback(url);
    if (decision.kind === 'ignored') return;
    await Browser.close().catch(() => undefined);
    if (decision.kind === 'cancelled') { setBusy(false); setMessage('Sign-in was not completed.'); return; }
    const { code, verifier } = decision;
    try {
      const response = await CapacitorHttp.post({ url: `${API}/api/mobile/auth/exchange`, headers: { 'Content-Type': 'application/json' }, data: { code, verifier }, connectTimeout: 10000, readTimeout: 20000 });
      if (response.status !== 200) throw new Error('Sign-in could not be completed.');
      const result = response.data as { token: string };
      setToken(result.token); setMessage('');
    } catch (error) { setMessage((error as Error).message); }
    finally { loginAttempt.finish(); setBusy(false); }
    }).then(value => { if (disposed) void value.remove(); else appListener = value; });
    void Browser.addListener('browserFinished', () => {
      if (loginAttempt.browserFinished()) setBusy(false);
    }).then(value => { if (disposed) void value.remove(); else browserListener = value; });
    return () => { disposed = true; void appListener?.remove(); void browserListener?.remove(); };
  }, []);
  async function signIn() {
    if (!API.startsWith('https://')) { setMessage('A secure AgentProof server address is required.'); return; }
    if (!loginAttempt.begin()) return;
    setBusy(true);
    setMessage('');
    try {
      const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
      loginAttempt.setVerifier(verifier);
      await Browser.open({ url: `${API}/api/mobile/auth/start?challenge=${base64url(digest)}` });
    } catch { loginAttempt.finish(); setBusy(false); setMessage('Could not open GitHub sign-in.'); }
  }
  async function openReport(report: Report) {
    if (!token) return;
    setSelected(report); setDetail(null); setBusy(true);
    try { setDetail(await api<Detail>(`/api/mobile/reports?id=${encodeURIComponent(report.id)}`, token)); setMessage(''); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function copyReport() {
    if (!detail || !selected || detail.copyEligible !== true || detail.freshness !== 'current') return;
    const requirements = detail.report?.requirements ?? [];
    const lines = ['# AgentProof evidence report', '', `PR #${detail.pullRequestNumber ?? selected.pullRequestNumber ?? '?'}`, `Priority: ${detail.report?.summary?.priority ?? selected.priority}`, `Verification: ${detail.verificationOutcome ?? 'unclear'}`, '', '## Requirements', ...requirements.map(item => `- ${item.requirementText ?? item.requirementId}: ${item.status}${item.gaps.length ? ` (${item.gaps.join('; ')})` : ''}`), '', '## Checks', `CI: ${detail.report?.testing?.ciStatus ?? 'unavailable'}`, `Lint: ${detail.report?.testing?.lintStatus ?? 'unavailable'}`, `Typecheck: ${detail.report?.testing?.typecheckStatus ?? 'unavailable'}`];
    try { await navigator.clipboard.writeText(lines.join('\n')); setMessage('Report copied to clipboard.'); } catch { setMessage('Clipboard access was unavailable.'); }
  }
  async function logout() {
    const currentToken = token;
    const status = await endLocalSession(
      () => currentToken ? api('/api/mobile/session', currentToken, 'DELETE') : Promise.resolve(),
      () => { loginAttempt.finish(); setToken(null); setSelected(null); setDetail(null); setReports([]); setRepositories([]); }
    );
    setMessage(status === 'revoked' ? 'Signed out.' : 'Signed out on this device. Server sign-out could not be confirmed.');
  }
  return <main><header><strong>AgentProof</strong><span>Evidence reports</span></header>{message && <p role="status" className="message">{message}</p>}{!token ? <section className="welcome"><p className="eyebrow">VERIFICATION WORKSPACE</p><h1>Review the evidence behind each PR.</h1><p>Sign in with GitHub to view reports for your connected repositories.</p><button disabled={busy} onClick={() => void signIn()}>{busy ? 'Signing in…' : 'Continue with GitHub'}</button></section> : <><nav><button onClick={() => { setSelected(null); setDetail(null); }}>Reports</button><button onClick={() => void logout()}>Sign out</button></nav>{selected ? <section><button className="back" onClick={() => { setSelected(null); setDetail(null); }}>← All reports</button><p className="eyebrow">PR #{selected.pullRequestNumber ?? '—'}</p><h1>Evidence report</h1>{busy ? <p>Loading…</p> : detail ? <><p>Verification: {detail.verificationOutcome ?? 'unclear'}</p><p>Freshness: {detail.freshness ?? 'unknown'}</p><p>Priority: {detail.report?.summary?.priority ?? selected.priority}</p>{detail.report?.summary?.overview && <p>{detail.report.summary.overview}</p>}<h2>Requirements</h2>{detail.report?.requirements?.length ? detail.report.requirements.map(item => <article key={item.requirementId}><h3>{item.requirementText ?? item.requirementId}</h3><p>{item.status}</p>{item.gaps.map((gap, i) => <p key={i}>{gap}</p>)}</article>) : <p>No explicit requirements found.</p>}<h2>Checks</h2><p>CI: {detail.report?.testing?.ciStatus ?? 'unavailable'} · Lint: {detail.report?.testing?.lintStatus ?? 'unavailable'} · Typecheck: {detail.report?.testing?.typecheckStatus ?? 'unavailable'}</p><button disabled={detail.copyEligible !== true || detail.freshness !== 'current'} onClick={() => void copyReport()}>Copy report summary</button></> : <p>Report unavailable.</p>}</section> : <section><p className="eyebrow">YOUR WORKSPACE</p><h1>Reports</h1><h2>Repositories</h2>{repositories.length ? <ul>{repositories.map(repo => <li key={repo.repositoryFullName}>{repo.repositoryFullName}{repo.repositoryPrivate ? ' · Private' : ''}</li>)}</ul> : <p>No connected repositories.</p>}<h2>Recent reports</h2>{reports.length ? reports.map(report => <button className="report" key={report.id} onClick={() => void openReport(report)}><span>PR #{report.pullRequestNumber ?? '—'}</span><small>{report.priority} · {report.freshness ?? 'unknown'} · {new Date(report.createdAt).toLocaleDateString()}</small></button>) : <p>No saved reports yet.</p>}</section>}</>}</main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
