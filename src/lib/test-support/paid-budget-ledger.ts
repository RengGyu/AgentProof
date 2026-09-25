/** In-memory RPC stand-in; exercises the real budget scope without paid calls. */
export function paidBudgetLedger() {
  const closed = new Set<string>();
  const reserved: string[] = [];
  return {
    closed, reserved,
    async fetch(init?: RequestInit) {
      const body = JSON.parse(String(init?.body));
      if (body.p_action === "config") return Response.json({ allowed: true, config: {
        timeZone: "Asia/Seoul", krwPerUsd: "1000", validUntil: "2099-01-01T00:00:00Z",
        prices: { "google/test": { inputUsdPerMillion: "1", outputUsdPerMillion: "1", callReserveKrw: "100", source: "https://example.test/prices" } }
      } });
      if (body.p_action === "reserve") {
        if (closed.has(body.p_run)) return Response.json({ allowed: false, reason: "duplicate" });
        reserved.push(body.p_run);
      }
      if (body.p_action === "close") closed.add(body.p_run);
      return Response.json({ allowed: true });
    }
  };
}
