import type { VerificationReport } from './types';

export interface AnalyzeResponse {
  report?: VerificationReport;
  loginRequired?: boolean;
  installRequired?: boolean;
  connectionRequired?: boolean;
  error?: string;
  hint?: string;
  guidance?: string[];
}

/** Edge limits and upstream outages may return HTML instead of our JSON envelope. */
export async function readAnalyzeResponse(response: Response): Promise<AnalyzeResponse> {
  const body = await response.json().catch(() => null);
  if (response.ok) {
    return body?.report && typeof body.report === 'object'
      ? {report: body.report as VerificationReport}
      : {error: 'Analysis response did not include a report.', hint: 'Please retry. Your PR URL and pasted context remain in the form.'};
  }
  const text = (value: unknown) => typeof value === 'string' ? value.slice(0, 1000) : undefined;
  const hint = text(body?.hint) ?? (response.status === 429 || response.status >= 500 ? 'Wait a moment before you retry. Your PR URL and pasted context remain in the form.' : 'Check the input and access permissions, then retry. Your PR URL and pasted context remain in the form.');
  return {
    ...(response.status === 401 && (body?.code === 'github_login_required' || body?.code === 'github_reauth_required') ? {loginRequired: true} : {}),
    ...(body?.code === 'github_install_required' ? {installRequired: true} : {}),
    ...(body?.code === 'github_connection_required' ? {connectionRequired: true} : {}),
    error: text(body?.error) ?? (response.status === 429 ? 'Too many requests. Please wait before retrying.' : response.status >= 500 ? 'Analysis is temporarily unavailable.' : 'Analysis request could not be completed.'),
    hint,
    guidance: Array.isArray(body?.guidance) ? body.guidance.filter((item: unknown): item is string => typeof item === 'string' && item !== hint).slice(0, 3).map((item: string) => item.slice(0, 1000)) : [],
  };
}
