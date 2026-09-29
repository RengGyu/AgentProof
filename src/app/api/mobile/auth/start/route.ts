import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { noStoreJson } from "@/lib/http";
import { getGitHubOAuthConfig, GitHubOAuthError } from "@/lib/public-github-auth";
import { mobileAuthConfigured, validMobileChallenge } from "@/lib/mobile-auth";

const COOKIE = "agentproof_mobile_oauth";
const TTL = 15 * 60;

export async function GET(request: Request) {
  try {
    const config = getGitHubOAuthConfig();
    if (!config || !mobileAuthConfigured()) return noStoreJson({ code: "mobile_auth_unavailable" }, { status: 503 });
    const url = new URL(request.url);
    if (url.origin !== new URL(config.callbackUrl).origin || (url.protocol !== "https:" && url.hostname !== "localhost")) return noStoreJson({ code: "mobile_auth_origin_invalid" }, { status: 409 });
    const challenge = url.searchParams.get("challenge");
    if (!validMobileChallenge(challenge)) return noStoreJson({ code: "mobile_challenge_invalid" }, { status: 400 });
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const payload = JSON.stringify({ state, verifier, challenge, expiresAt: Date.now() + TTL * 1000 });
    const packed = seal(payload, config.secret);
    const authorizationUrl = new URL("https://github.com/login/oauth/authorize");
    authorizationUrl.searchParams.set("client_id", config.clientId);
    authorizationUrl.searchParams.set("redirect_uri", new URL("/api/mobile/auth/callback", url.origin).toString());
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    const headers = new Headers({ Location: authorizationUrl.toString(), "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
    headers.append("Set-Cookie", `${COOKIE}=${packed}; Path=/api/mobile/auth/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL}`);
    return new Response(null, { status: 302, headers });
  } catch (error) {
    if (error instanceof GitHubOAuthError) return noStoreJson({ code: "mobile_auth_unavailable" }, { status: 503 });
    throw error;
  }
}

export function openMobileOAuthCookie(header: string | null, secret: string): { state: string; verifier: string; challenge: string } | null {
  const packed = header?.split(";").map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!packed) return null;
  try {
    const [payload, signature] = packed.split(".");
    if (!payload || !signature || !safeEqual(sealSignature(payload, secret), signature)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { state: string; verifier: string; challenge: string; expiresAt: number };
    return data.expiresAt > Date.now() && validMobileChallenge(data.challenge) ? data : null;
  } catch { return null; }
}

function seal(payload: string, secret: string): string {
  const encoded = Buffer.from(payload).toString("base64url");
  return `${encoded}.${sealSignature(encoded, secret)}`;
}
function sealSignature(value: string, secret: string) { return createHmac("sha256", secret).update("mobile\0").update(value).digest("base64url"); }
function safeEqual(a: string, b: string) { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
