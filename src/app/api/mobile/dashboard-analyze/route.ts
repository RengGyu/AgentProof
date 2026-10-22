import {POST as enqueue,GET as status} from "@/lib/workspace-server/queued-analysis";
export const maxDuration = 300;
export function POST(request:Request){return enqueue(request,"mobile");}
export function GET(request:Request){return status(request,"mobile");}
