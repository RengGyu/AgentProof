import { GET as readWorkspace } from "@/lib/workspace-server/reports";
export function GET(request: Request) { return readWorkspace(request, "mobile"); }
