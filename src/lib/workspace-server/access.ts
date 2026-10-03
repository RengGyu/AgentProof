import { resolveTenantAuthAccess } from '@/lib/tenant-auth';
import { mobileCookieFromRequest } from '@/lib/mobile-auth';
import { verifySameOriginMutationRequest } from '@/lib/csrf';

/** Selected by route code, never by a caller-controlled header or query. */
export type WorkspaceSource = 'web' | 'mobile';
export function resolveWorkspaceAccess(request: Request, source: WorkspaceSource) {
  return source === 'mobile'
    ? resolveTenantAuthAccess({cookieHeader: mobileCookieFromRequest(request), expectedSource:'mobile'})
    : resolveTenantAuthAccess({cookieHeader: request.headers.get('cookie')});
}
export function validWorkspaceMutation(request: Request, source: WorkspaceSource): boolean {
  // Native calls carry no ambient browser authority. Every handler must also
  // resolve the revocable mobile session before accessing tenant data.
  return source === 'mobile' ? mobileCookieFromRequest(request) !== null : verifySameOriginMutationRequest(request).ok;
}
