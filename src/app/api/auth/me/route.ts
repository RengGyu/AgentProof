import { noStoreJson } from "@/lib/http";
import { readConciergeGitHubSession } from "@/lib/concierge-github-auth";

export async function GET(request: Request) {
  try {
    const session = await readConciergeGitHubSession(request.headers.get("cookie"));
    return noStoreJson(session ? { authenticated: true, authMethod: "github", repositoriesAvailable: session.repositoryIds.length > 0 } : { authenticated: false });
  } catch { return noStoreJson({ authenticated: false, code: "auth_unavailable" }, { status: 503 }); }
}
