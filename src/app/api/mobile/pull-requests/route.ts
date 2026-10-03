import { GET as readWorkspace } from "@/lib/workspace-server/pull-requests";
export function GET(request: Request) { return readWorkspace(request, "mobile"); }
