import { noStoreJson } from "@/lib/http";
import { clearConciergeGitHubSessionCookie, revokeConciergeGitHubSession } from "@/lib/concierge-github-auth";
import { verifySameOriginMutationRequest } from "@/lib/csrf";

export async function DELETE(request: Request) {
  if (!verifySameOriginMutationRequest(request).ok) return noStoreJson({ code: "csrf_rejected" }, { status: 403 });
  try {
    const revoked = await revokeConciergeGitHubSession(request.headers.get("cookie"));
    if (!revoked) return noStoreJson({ deleted: false, code: "auth_unavailable" }, { status: 503 });
    return withClearedSessionCookie(noStoreJson({ deleted: true }), clearConciergeGitHubSessionCookie());
  } catch { return noStoreJson({ deleted: false, code: "auth_unavailable" }, { status: 503 }); }
}

function withClearedSessionCookie(response: Response, cookie: string): Response {
  response.headers.append("Set-Cookie", cookie);
  return response;
}
