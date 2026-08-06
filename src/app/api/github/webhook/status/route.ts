import { getPublicGitHubAppReadinessStatusAsync } from "@/lib/github-app";
import { noStoreJson } from "@/lib/http";

export async function GET() {
  return noStoreJson({
    githubApp: await getPublicGitHubAppReadinessStatusAsync()
  });
}
