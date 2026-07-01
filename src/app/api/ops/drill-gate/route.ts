import { noStoreJson } from "@/lib/http";
import { verifyOpsRequest } from "@/lib/ops-auth";
import { OpsDrillGateError, readOpsDrillGateSummary } from "@/lib/ops-drill-gate";

export async function GET(request: Request) {
  const auth = verifyOpsRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const summary = readOpsDrillGateSummary();

    return noStoreJson({
      ok: true,
      ...summary
    });
  } catch (error) {
    if (error instanceof OpsDrillGateError) {
      return noStoreJson({
        error: "Ops drill gate evidence is unavailable.",
        code: "ops_drill_gate_unavailable"
      }, { status: 503 });
    }

    throw error;
  }
}
