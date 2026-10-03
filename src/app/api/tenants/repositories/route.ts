import { GET as readSettings, PATCH as updateSettings } from "@/lib/workspace-server/repository-settings";
export function GET(request: Request) { return readSettings(request); }
export function PATCH(request: Request) { return updateSettings(request, "web"); }
