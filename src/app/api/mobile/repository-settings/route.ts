import { PATCH as updateSettings } from "@/lib/workspace-server/repository-settings";
export function PATCH(request: Request) { return updateSettings(request, "mobile"); }
