import { GET as readCode } from "@/lib/workspace-server/report-code";
export function GET(request: Request) { return readCode(request, "mobile"); }
