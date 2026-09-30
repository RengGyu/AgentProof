import { handlePersonalAccountDeletion } from "@/lib/personal-account-deletion";
export async function GET(request: Request) { return handlePersonalAccountDeletion(request, "mobile"); }
export async function POST(request: Request) { return handlePersonalAccountDeletion(request, "mobile"); }
