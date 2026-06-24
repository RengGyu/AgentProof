import { NextResponse } from "next/server";
import { demoScenarios } from "@/lib/sample-data";
import { buildPullRequestInput } from "@/lib/github";
import { generateVerificationReport } from "@/lib/verifier";
import type { AnalyzeRequest } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AnalyzeRequest;
    const input = body.demoScenario
      ? demoScenarios[body.demoScenario]
      : await buildPullRequestInput(body);

    const report = generateVerificationReport(input);

    return NextResponse.json({ report });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";

    return NextResponse.json(
      {
        error: message,
        hint: "Use demo mode, paste PR evidence, or provide a fine-grained GitHub token for private PRs."
      },
      { status: 400 }
    );
  }
}
