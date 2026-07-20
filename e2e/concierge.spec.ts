import { expect, test } from "@playwright/test";

type TaskState = "available" | "unavailable" | "ambiguous";

function fixture(taskState: TaskState = "available", ciStatus: "passed" | "failed" = "passed") {
  const unavailable = taskState !== "available";
  const gapKind = ciStatus === "failed" ? "failed_execution" : unavailable ? "evidence_unavailable" : "missing_targeted_test";
  const evidenceId = ciStatus === "failed" ? "check:test" : "file:src/feature.ts";
  return {
    analysisId: "synthetic-concierge-report", createdAt: "2026-07-14T00:00:00.000Z",
    source: {
      title: "Synthetic private PR", url: "https://github.com/acme/private/pull/17",
      provenance: { version: 1, origin: "github_snapshot", headSha: "a".repeat(40), evidenceCapturedAt: "2026-07-14T00:00:00.000Z", inputFingerprint: { version: 1, algorithm: "sha256", value: "b".repeat(64), coverage: "github_metadata" } },
      originalTask: taskState === "available" ? { version: 1, status: "available", sourceType: "linked_issue", reason: "none", sourceRef: "github_issue:42" } : { version: 1, status: taskState, sourceType: "none", reason: taskState === "ambiguous" ? "multiple_linked_issues" : "not_linked" }
    },
    summary: { oneLine: "Synthetic deterministic evidence report.", confidence: 0.5, priority: ciStatus === "failed" ? "blocker" : "high", evidenceCoverage: 50, topRisks: ["A deterministic proof gap remains."] },
    requirements: [{ requirementId: "req_opaque", requirementText: unavailable ? "Authoritative task unavailable." : "The feature must reject invalid input.", status: unavailable ? "unclear" : "partial", evidenceRefs: [evidenceId], gaps: ["Targeted proof is missing."], reviewerNote: "Inspect the cited evidence before deciding.", confidence: 0.3 }],
    claims: [], scope: { suspected: false, outOfScopeFiles: [], reasons: [], evidenceRefs: [], provenance: [] },
    testing: { ciStatus, lintStatus: "passed", typecheckStatus: "passed", missingTests: [] },
    reviewPriority: [{ priority: ciStatus === "failed" ? "blocker" : "high", title: "Inspect deterministic gap", reason: "A cited proof gap remains.", evidenceRefs: [evidenceId] }],
    proofGraph: { version: 1, nodes: [{ requirementId: "req_opaque", requirementText: "Synthetic requirement", sourceRole: "core_requirement", sourceQuality: "high", sourceSection: null, contextRoles: [], status: unavailable ? "unclear" : "partial", confidence: 0.3, implementationEvidenceRefs: [evidenceId], targetedTestEvidenceRefs: [], executionEvidenceRefs: ciStatus === "failed" ? [evidenceId] : [], gapSignals: [{ kind: gapKind, severity: ciStatus === "failed" ? "blocker" : "high", message: "Synthetic cited proof gap.", evidenceRefs: [evidenceId] }], firstFiles: ["src/feature.ts"] }], context: [], summary: { requirementCount: 1, requirementsWithImplementation: 1, requirementsWithTargetedTests: 0, requirementsWithExecution: ciStatus === "failed" ? 1 : 0, requirementsWithGaps: 1, gapCount: 1 } },
    reprompt: { targetAgent: "codex", prompt: "Inspect the cited deterministic evidence only.", evidenceRefs: [evidenceId], basedOnGapKind: gapKind },
    decisionCard: { version: 1, topGap: { gapKey: `req_opaque:${gapKind}:${evidenceId}`, requirementId: ciStatus === "failed" ? null : "req_opaque", kind: gapKind, severity: ciStatus === "failed" ? "blocker" : "high", summary: "Synthetic cited proof gap.", evidenceRefs: [evidenceId] }, testBuildStatus: ciStatus, firstInspectionPoints: [{ kind: ciStatus === "failed" ? "check" : "file", label: ciStatus === "failed" ? "test check" : "src/feature.ts", href: ciStatus === "failed" ? "https://github.com/acme/private/actions/runs/1" : `https://github.com/acme/private/blob/${"a".repeat(40)}/src/feature.ts`, evidenceRefs: [evidenceId] }], reprompt: { prompt: "Inspect the cited deterministic evidence only.", gapKey: `req_opaque:${gapKind}:${evidenceId}`, basedOnGapKind: gapKind, evidenceRefs: [evidenceId] } },
    evidenceIndex: [{ id: evidenceId, kind: ciStatus === "failed" ? "check" : "changed_file", label: ciStatus === "failed" ? "test check" : "src/feature.ts", locator: ciStatus === "failed" ? "https://github.com/acme/private/actions/runs/1" : "src/feature.ts", confidence: 0.9, summary: ciStatus === "failed" ? "Status: failed; synthetic bounded check evidence." : "Synthetic bounded file evidence." }],
    limitations: ["Synthetic browser fixture only."]
  };
}

async function fillAndRun(page: import("@playwright/test").Page) {
  const inputs = page.locator("input");
  await inputs.nth(0).fill("tenant_alpha"); await inputs.nth(1).fill("101"); await inputs.nth(2).fill("202"); await inputs.nth(3).fill("acme/private"); await inputs.nth(4).fill("17");
  await page.getByRole("button", { name: "수동 분석 실행" }).click();
}

async function interceptSuccess(page: import("@playwright/test").Page, report: Record<string, unknown> = fixture()) {
  await page.route("**/api/tenants/concierge/analyze", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.repositoryFullName).toBe("acme/private");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ report, caseIdOrHash: "c".repeat(64), privacy: "synthetic" }) });
  });
}

async function tabUntil(page: import("@playwright/test").Page, locator: import("@playwright/test").Locator, limit = 100) {
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press("Tab");
    if (await locator.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error(`Keyboard Tab path did not reach ${await locator.getAttribute("aria-label") ?? await locator.textContent() ?? "target"}.`);
}

function zeroGapFixture() {
  const report = fixture();
  return {
    ...report,
    summary: { ...report.summary, priority: "low", topRisks: ["No major evidence gap found from available evidence."] },
    requirements: report.requirements.map((requirement) => ({ ...requirement, status: "met", gaps: [] })),
    proofGraph: { ...report.proofGraph, nodes: report.proofGraph.nodes.map((node) => ({ ...node, status: "met", gapSignals: [] })), summary: { ...report.proofGraph.summary, requirementsWithGaps: 0, gapCount: 0 } },
    decisionCard: { ...report.decisionCard, topGap: null, reprompt: null }
  };
}

test("desktop success focuses the evidence report, copies the bound re-prompt, and leaves no browser storage", async ({ page, context }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => { if (!request.url().startsWith("http://127.0.0.1:3108/")) externalRequests.push(request.url()); });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:3108" });
  await interceptSuccess(page);
  await page.goto("/concierge");
  await fillAndRun(page);
  const report = page.getByLabel("Concierge evidence report");
  await expect(report).toBeVisible();
  await expect(report).toBeFocused();
  await expect(page.getByText("Synthetic cited proof gap.").first()).toBeVisible();
  await page.getByRole("button", { name: "복사" }).click();
  await expect(page.getByRole("button", { name: "복사됨" })).toBeVisible();
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
  expect(await page.evaluate(async () => ({ caches: await caches.keys(), indexed: await indexedDB.databases().then((items) => items.map((item) => item.name)) }))).toEqual({ caches: [], indexed: [] });
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Inspect the cited deterministic evidence only.");
  expect(externalRequests).toEqual([]);
});

test("keyboard focus reaches intake, report evidence, feedback, reset, and session-end controls", async ({ page }) => {
  await interceptSuccess(page);
  await page.route("**/api/tenants/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ deleted: true }) }));
  await page.goto("/concierge");
  await expect(page.getByText("Privacy notice — human-beta-privacy.v1")).toBeVisible();
  await expect(page.getByText(/삭제는 현재 운영자 수동 절차이며 자동화되지 않았습니다/)).toBeVisible();
  const orderedValues: Array<[string, string]> = [["tenantId", "tenant_alpha"], ["installationId", "101"], ["repositoryId", "202"], ["repositoryFullName", "acme/private"], ["pullRequestNumber", "17"]];
  await page.keyboard.press("Tab");
  for (const [index, [name, value]] of orderedValues.entries()) {
    const input = page.getByRole("textbox", { name });
    await expect(input).toBeFocused();
    await page.keyboard.type(value);
    await page.keyboard.press("Tab");
    if (index + 1 < orderedValues.length) await expect(page.getByRole("textbox", { name: orderedValues[index + 1][0] })).toBeFocused();
  }
  await expect(page.getByRole("textbox", { name: "명시적 original task (선택, 없으면 linked issue 1개만 사용)" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "수동 분석 실행" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Concierge evidence report")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "src/feature.ts" })).toBeFocused();
  await tabUntil(page, page.getByLabel("Operator-issued opaque partner ID"));
  await page.keyboard.type("partner_a1b2c3d4");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Session ordinal")).toBeFocused();
  await tabUntil(page, page.getByRole("button", { name: "새 테스트 시작" }));
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Concierge evidence report")).toHaveCount(0);
  await tabUntil(page, page.getByRole("textbox", { name: "tenantId" }));
  for (const [name, value] of orderedValues) {
    const input = page.getByRole("textbox", { name });
    await expect(input).toBeFocused(); await page.keyboard.type(value); await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Concierge evidence report")).toBeFocused();
  await tabUntil(page, page.getByRole("button", { name: "세션 종료" }));
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Concierge evidence report")).toHaveCount(0);
});

test("mobile places the completed report before collapsed intake", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await interceptSuccess(page);
  await page.goto("/concierge"); await fillAndRun(page);
  expect(await page.getByLabel("Concierge evidence report").evaluate((element) => getComputedStyle(element).order)).toBe("1");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.close();
});

test("320px mobile keeps zero-gap feedback and reset controls operable without horizontal overflow", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 720 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await interceptSuccess(page, zeroGapFixture());
  await page.route("**/api/tenants/concierge/feedback", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stored: true, duplicate: false, privacy: "bounded-metadata-only" }) }));
  await page.route("**/api/tenants/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ deleted: true }) }));
  await page.goto("/concierge"); await fillAndRun(page);
  await expect(page.getByLabel("Top-gap outcome")).toHaveValue("not_applicable_zero_gap");
  await expect(page.getByRole("button", { name: "Save bounded feedback" })).toBeVisible();
  await expect(page.getByRole("button", { name: "새 테스트 시작" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const box = await page.getByRole("button", { name: "새 테스트 시작" }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.getByLabel("Operator-issued opaque partner ID").fill("partner_a1b2c3d4");
  await page.getByRole("button", { name: "Save bounded feedback" }).tap();
  await expect(page.getByText("metadata_saved")).toBeVisible();
  await page.getByRole("button", { name: "새 테스트 시작" }).tap();
  await expect(page.getByLabel("Concierge evidence report")).toHaveCount(0);
  await fillAndRun(page);
  await page.getByRole("button", { name: "세션 종료" }).tap();
  await expect(page.getByLabel("Concierge evidence report")).toHaveCount(0);
  await context.close();
});

test("zero-gap report shows bounded evidence language without fabricating a re-prompt", async ({ page }) => {
  await interceptSuccess(page, zeroGapFixture());
  await page.goto("/concierge"); await fillAndRun(page);
  await expect(page.getByText("현재 증거 요약")).toBeVisible();
  await expect(page.getByText("수집된 증거 범위에서는 우선 검토할 증거 공백을 찾지 못했습니다.")).toBeVisible();
  await expect(page.getByText("참고 증거")).toBeVisible();
  await expect(page.getByText("이 보고서는 merge 결정이나 correctness 인증이 아닙니다.")).toBeVisible();
  await expect(page.getByRole("button", { name: "복사" })).toHaveCount(0);
  await expect(page.locator(".concierge-reprompt")).toHaveCount(0);
});

test("bounded feedback leaves cohort assignment to the server without sending report or repository content", async ({ page }) => {
  let feedbackBody: any = null;
  await interceptSuccess(page);
  await page.route("**/api/tenants/concierge/feedback", async (route) => {
    feedbackBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stored: true, duplicate: false, privacy: "bounded-metadata-only" }) });
  });
  await page.goto("/concierge"); await fillAndRun(page);
  await page.getByLabel("Operator-issued opaque partner ID").fill("partner_a1b2c3d4");
  await page.getByLabel("Top-gap outcome").selectOption("found_within_30s");
  await page.getByLabel("Observed seconds (blank if unavailable)").fill("12");
  await page.getByRole("button", { name: "Save bounded feedback" }).click();
  await expect(page.getByText("metadata_saved")).toBeVisible();
  expect(Object.keys(feedbackBody ?? {}).sort()).toEqual(["feedback", "tenantId"]);
  const feedback = (feedbackBody?.feedback ?? {}) as Record<string, unknown>;
  expect(feedback).toMatchObject({ schemaVersion: "concierge-feedback.v3", privacyNoticeVersion: "human-beta-privacy.v1", topGapOutcome: "found_within_30s", foundTopGapWithin30s: true, timeToTopGapSeconds: 12 });
  expect(feedback).not.toHaveProperty("participantCohort");
  const serialized = JSON.stringify(feedbackBody);
  expect(serialized).not.toContain("acme/private");
  expect(serialized).not.toContain("Synthetic private PR");
  expect(serialized).not.toContain("Inspect the cited deterministic evidence only.");
  expect(serialized).not.toContain("diff --git");
});

test("new-test and end-session controls clear private report state", async ({ page }) => {
  await interceptSuccess(page);
  await page.goto("/concierge"); await fillAndRun(page);
  await page.getByRole("button", { name: "새 테스트 시작" }).click();
  await expect(page.getByLabel("Concierge evidence report")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "tenantId" })).toHaveValue("");

  await fillAndRun(page);
  await page.route("**/api/tenants/auth/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, deleted: true, privacy: "tenant-auth-session-cookie-only" }) }));
  await page.getByRole("button", { name: "세션 종료" }).click();
  await expect(page.getByLabel("Concierge evidence report")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "tenantId" })).toHaveValue("");
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
});

test("unavailable, ambiguous, and failed-check fixtures never display met and retain bounded deterministic navigation", async ({ browser }) => {
  for (const report of [fixture("unavailable"), fixture("ambiguous"), fixture("available", "failed")]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await interceptSuccess(page, report); await page.goto("/concierge"); await fillAndRun(page);
    await expect(page.getByLabel("Concierge evidence report")).toBeVisible();
    await expect(page.getByText("met", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link").first()).toHaveAttribute("href", /github\.com\/acme\/private/);
    await context.close();
  }
});

test("GitHub-equivalent bounded failures show an error and do not create report or browser storage", async ({ page }) => {
  for (const code of ["401", "403", "404", "429", "500", "timeout"]) {
    await page.route("**/api/tenants/concierge/analyze", (route) => route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ code }) }));
    await page.goto("/concierge"); await fillAndRun(page);
    await expect(page.locator(".intake-error")).toHaveText(code);
    await expect(page.getByLabel("Concierge evidence report")).toHaveCount(0);
    expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
    await page.unroute("**/api/tenants/concierge/analyze");
  }
});

test("an error envelope cannot surface an injected report or persist it in browser storage", async ({ page }) => {
  const rawPrivateText = "diff --git a/private.ts b/private.ts";
  await page.route("**/api/tenants/concierge/analyze", (route) => route.fulfill({
    status: 502,
    contentType: "application/json",
    headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" },
    body: JSON.stringify({ code: "github_evidence_unavailable", report: { rawPrivateText } })
  }));
  await page.goto("/concierge"); await fillAndRun(page);
  await expect(page.locator(".intake-error")).toHaveText("github_evidence_unavailable");
  await expect(page.getByLabel("Concierge evidence report")).toHaveCount(0);
  await expect(page.getByText(rawPrivateText)).toHaveCount(0);
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), cache: performance.getEntriesByType("resource").map((entry) => entry.name) }))).toMatchObject({ local: [], session: [] });
});
