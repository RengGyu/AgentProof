import { GET as readWorkspace } from "@/lib/workspace-server/repositories";
export function GET(request: Request) { return readWorkspace(request, "web"); }
