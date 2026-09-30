"use client";

import AccountDeletionPanel, { parseDeletionResult } from "@/components/AccountDeletionPanel";

async function request(remove: boolean) {
  const response = await fetch("/api/account/deletion", {
    method: remove ? "POST" : "GET", cache: "no-store", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "x-agentproof-csrf": "same-origin" },
    ...(remove ? { body: JSON.stringify({ confirmation: "DELETE" }) } : {})
  });
  return parseDeletionResult(await response.json());
}
async function signIn() {
  const response = await fetch("/api/auth/github/start", {
    method: "POST", headers: { "Content-Type": "application/json", "x-agentproof-csrf": "same-origin" },
    body: JSON.stringify({ returnTo: "/account/delete" })
  });
  const result = await response.json();
  if (!response.ok || typeof result.authorizationUrl !== "string") throw new Error("Sign-in unavailable");
  window.location.assign(result.authorizationUrl);
}
export default function DeleteAccountPage() {
  return <main style={{ maxWidth: 680, margin: "48px auto", padding: 24 }}>
    <a href="/dashboard">AgentProof</a>
    <AccountDeletionPanel request={request} signIn={signIn} />
  </main>;
}
