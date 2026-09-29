export type PendingLogin = { verifier: string } | null;

export function createLoginAttempt() {
  let phase: 'idle' | 'starting' | 'browser' | 'exchanging' = 'idle';
  let verifier: string | null = null;
  return {
    begin() {
      if (phase !== 'idle') return false;
      phase = 'starting';
      return true;
    },
    setVerifier(value: string) { verifier = value; phase = 'browser'; },
    callback(url: string) {
      if (phase !== 'browser') return { kind: 'ignored' } as const;
      const decision = resolveLoginLink(url, verifier ? { verifier } : null);
      if (decision.kind !== 'ignored') {
        verifier = null;
        phase = decision.kind === 'exchange' ? 'exchanging' : 'idle';
      }
      return decision;
    },
    browserFinished() {
      if (phase !== 'browser') return false;
      verifier = null;
      phase = 'idle';
      return true;
    },
    finish() { verifier = null; phase = 'idle'; },
    active() { return phase !== 'idle'; }
  };
}

export function resolveLoginLink(url: string, pending: PendingLogin):
  | { kind: 'ignored' }
  | { kind: 'cancelled' }
  | { kind: 'exchange'; code: string; verifier: string } {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { kind: 'ignored' }; }
  if (parsed.protocol !== 'agentproof:' || parsed.host !== 'auth' || parsed.pathname !== '/callback') return { kind: 'ignored' };
  if (!pending) return { kind: 'ignored' };
  const code = parsed.searchParams.get('code');
  if (!code || !/^[A-Za-z0-9_-]{43}$/.test(code)) return { kind: 'cancelled' };
  return { kind: 'exchange', code, verifier: pending.verifier };
}

export async function endLocalSession(
  revoke: () => Promise<unknown>,
  clear: () => void
): Promise<'revoked' | 'remote-unverified'> {
  // Local report data and bearer must leave memory even when network revocation fails.
  clear();
  try { await revoke(); return 'revoked'; }
  catch { return 'remote-unverified'; }
}
