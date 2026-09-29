import { noStoreJson } from "@/lib/http";
import { exchangeMobileHandoff, MobileAuthStoreError } from "@/lib/mobile-auth";

export async function POST(request: Request) {
  if (request.headers.get("origin") || request.headers.get("cookie")) return noStoreJson({ code: "mobile_exchange_invalid" }, { status: 403 });
  const body = await request.text();
  if (body.length > 1024) return noStoreJson({ code: "mobile_exchange_invalid" }, { status: 400 });
  try {
    const input = JSON.parse(body) as { code?: unknown; verifier?: unknown };
    const token = await exchangeMobileHandoff({ code: input.code, verifier: input.verifier });
    return token ? noStoreJson({ ok: true, token }) : noStoreJson({ code: "mobile_exchange_invalid" }, { status: 401 });
  } catch (error) {
    if (error instanceof MobileAuthStoreError) return noStoreJson({ code: "mobile_exchange_unavailable" }, { status: 503 });
    return noStoreJson({ code: "mobile_exchange_invalid" }, { status: 400 });
  }
}
