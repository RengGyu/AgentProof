import { PublicGitHubEntry } from "@/components/PublicGitHubEntry";

export default function Home() {
  return <PublicGitHubEntry previewDemoAvailable={process.env.VERCEL_ENV === "preview"} />;
}
