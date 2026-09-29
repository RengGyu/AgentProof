import { describe, expect, it, vi } from 'vitest';
import { createLoginAttempt, endLocalSession, resolveLoginLink } from './auth-flow';

const pending = { verifier: 'v'.repeat(64) };
const code = 'a'.repeat(43);
describe('mobile login link and logout state', () => {
  it('only exchanges the expected callback with a pending verifier', () => {
    expect(resolveLoginLink(`agentproof://auth/callback?code=${code}`, pending)).toEqual({ kind: 'exchange', code, verifier: pending.verifier });
    expect(resolveLoginLink(`agentproof://auth/callback?code=${code}`, null)).toEqual({ kind: 'ignored' });
  });
  it('keeps pending login for unrelated links and cancels only its callback', () => {
    expect(resolveLoginLink('agentproof://reports/callback?code=x', pending)).toEqual({ kind: 'ignored' });
    expect(resolveLoginLink('https://other.example/?code=x', pending)).toEqual({ kind: 'ignored' });
    expect(resolveLoginLink('agentproof://auth/callback?error=access_denied', pending)).toEqual({ kind: 'cancelled' });
  });
  it('clears local auth and reports even when revocation fails', async () => {
    const clear = vi.fn();
    const revoke = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await endLocalSession(revoke, clear)).toBe('remote-unverified');
    expect(clear).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledOnce();
  });
  it('keeps one login attempt active through browser return and exchange', () => {
    const login = createLoginAttempt();
    expect(login.begin()).toBe(true);
    expect(login.begin()).toBe(false);
    login.setVerifier(pending.verifier);
    expect(login.callback('agentproof://unrelated')).toEqual({ kind: 'ignored' });
    expect(login.active()).toBe(true);
    expect(login.callback(`agentproof://auth/callback?code=${code}`)).toEqual({ kind: 'exchange', code, verifier: pending.verifier });
    expect(login.browserFinished()).toBe(false);
    expect(login.begin()).toBe(false);
    login.finish();
    expect(login.active()).toBe(false);
    expect(login.begin()).toBe(true);
  });
  it('unlocks login when the browser closes or the callback fails', () => {
    const login = createLoginAttempt();
    expect(login.begin()).toBe(true);
    login.setVerifier(pending.verifier);
    expect(login.browserFinished()).toBe(true);
    expect(login.active()).toBe(false);
    expect(login.begin()).toBe(true);
    login.setVerifier(pending.verifier);
    expect(login.callback('agentproof://auth/callback?error=access_denied')).toEqual({ kind: 'cancelled' });
    expect(login.active()).toBe(false);
  });
});
