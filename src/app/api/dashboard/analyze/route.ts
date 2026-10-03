import { POST as analyze } from "@/lib/workspace-server/analyze";

export function POST(request: Request) {
  return analyze(request, "web", { retainReport: true });
}
