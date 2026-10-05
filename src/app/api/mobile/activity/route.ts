import { GET as readWorkspace, POST as clearInbox } from "@/lib/workspace-server/activity";
export function GET(request: Request) { return readWorkspace(request, "mobile"); }
export function POST(request: Request) { return clearInbox(request, "mobile"); }
