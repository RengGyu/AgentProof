import { expect, test } from "@playwright/test";

type TaskState = "available" | "unavailable" | "ambiguous";

function fixture(taskState: TaskState = "available", ciStatus: "passed" | "failed" = "passed", forcedGapKind?: "evidence_insufficient") {
  const unavailable = taskState !== "available";
  const gapKind = forcedGapKind ?? (ciStatus === "failed" ? "failed_execution" : unavailable ? "evidence_unavailable" : "missing_targeted_test");
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

async function fillSetup(page: import("@playwright/test").Page, options: { evaluation?: boolean } = {}) {
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true, authMethod: "github", repositoriesAvailable: true }) }));
  await page.route("**/api/auth/github/repositories", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: "ready", repositories: [{ fullName: "acme/private" }] }) }));
  const start = page.getByRole("button", { name: "PR 검토 시작" });
  if (await start.isVisible()) await start.click();
  await page.getByLabel("허용된 개인 저장소").selectOption("acme/private");
  await page.getByLabel("PR 번호").fill("17");
  if (options.evaluation) {
    await page.getByText("평가 진행 시에만 사용", { exact: true }).click();
    await page.getByLabel("보고서 전 예상").selectOption("targeted_test");
  }
}

async function fillAndRun(page: import("@playwright/test").Page) {
  await fillSetup(page);
  await page.getByRole("button", { name: "PR 근거 확인하기" }).click();
}

async function interceptSuccess(page: import("@playwright/test").Page, report: Record<string, unknown> = fixture()) {
  await page.route("**/api/tenants/concierge/analyze", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.repositoryFullName).toBe("acme/private");
    expect(Object.keys(body).sort()).toEqual(["pullRequestNumber", "repositoryFullName", "requestId"]);
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

test("welcome page keeps the guide character visible and separates setup from the landing page", async ({ page }) => {
  await page.goto("/concierge");
  await expect(page.getByRole("heading", { name: /PR을 읽기 전에/ })).toBeVisible();
  await expect(page.locator(".welcome-scene .proof-buddy.hero")).toBeVisible();
  await expect(page.getByText("병합 여부나 구현의 정확성을 판정하지 않습니다.")).toBeVisible();
  await expect(page.getByLabel("허용된 개인 저장소")).toHaveCount(0);
  await page.getByRole("button", { name: "PR 검토 시작" }).click();
  await expect(page.getByRole("heading", { name: "검토할 PR을 선택하세요" })).toBeVisible();
  await expect(page.getByRole("link", { name: /GitHub로 계속하기/ })).toBeVisible();
  await page.getByRole("button", { name: "← 소개로 돌아가기" }).click();
  await expect(page.getByRole("button", { name: "PR 검토 시작" })).toBeVisible();
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
});

test("desktop summary focuses the top gap, supports detail navigation, and leaves no browser storage", async ({ page, context }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => { if (!request.url().startsWith("http://127.0.0.1:3108/")) externalRequests.push(request.url()); });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:3108" });
  await interceptSuccess(page);
  await page.goto("/concierge");
  await fillAndRun(page);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const report = page.getByLabel("PR 증거 보고서");
  await expect(report).toBeVisible();
  await expect(report).toBeFocused();
  await expect(page.getByRole("heading", { name: "요구사항 대상 테스트 증거 없음" })).toBeVisible();
  await expect(page.getByText("요구사항 GitHub Issue #42")).toBeVisible();
  await expect(page.getByText("간단한 사용성 피드백", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "후속 요청 복사" }).click();
  await expect(page.getByRole("status")).toHaveText("후속 요청을 클립보드에 복사했습니다.");
  await page.getByRole("button", { name: /요구사항.*1개 항목의 구현 근거/ }).click();
  await expect(page.locator("#concierge-panel-requirements")).toBeFocused();
  await expect(page.getByRole("button", { name: "검토 요약으로" })).toBeVisible();
  await page.getByRole("button", { name: "테스트·CI" }).click();
  await expect(page.getByRole("heading", { name: "테스트와 CI" })).toBeVisible();
  await expect(page.getByLabel("CI 실행 상태: passed")).toBeVisible();
  await page.getByRole("button", { name: "증거 출처·제한사항" }).click();
  await expect(page.getByRole("heading", { name: "증거 출처·제한사항" })).toBeVisible();
  await page.getByRole("button", { name: "검토 요약으로" }).click();
  await expect(page.locator("#concierge-panel-summary")).toBeFocused();
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
  expect(await page.evaluate(async () => ({ caches: await caches.keys(), indexed: await indexedDB.databases().then((items) => items.map((item) => item.name)) }))).toEqual({ caches: [], indexed: [] });
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Inspect the cited deterministic evidence only.");
  expect(externalRequests).toEqual([]);
});

test("signed-out users see only the GitHub continuation without beta IDs", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: false }) }));
  await page.goto("/concierge");
  await page.getByRole("button", { name: "PR 검토 시작" }).click();
  await expect(page.getByRole("link", { name: /GitHub로 계속하기/ })).toBeVisible();
  await expect(page.getByLabel("베타 공간 ID")).toHaveCount(0);
  await expect(page.getByLabel("테스터 계정 ID")).toHaveCount(0);
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
});

test("a repository session 401 is shown as signed out, while public-only OAuth gets its own recovery message", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true, authMethod: "github", repositoriesAvailable: true }) }));
  await page.route("**/api/auth/github/repositories", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "session_invalid" }) }));
  await page.goto("/concierge");
  await page.getByRole("button", { name: "PR 검토 시작" }).click();
  await expect(page.getByRole("link", { name: /GitHub로 계속하기/ })).toBeVisible();
  await expect(page.getByText("GitHub 접근 권한이 변경되었습니다.")).toHaveCount(0);
  await page.unroute("**/api/auth/github/repositories");
  await page.unroute("**/api/auth/me");
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: false }) }));
  await page.goto("/concierge?auth=private_repository_required");
  await page.getByRole("button", { name: "PR 검토 시작" }).click();
  await expect(page.getByText("비공개 저장소가 필요합니다.")).toBeVisible();
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "다른 GitHub 계정으로 로그인" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /GitHub로 계속하기/ })).toBeVisible();
});

test("an actual authentication network timeout is not presented as a logout", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.route("**/api/auth/me", (route) => route.abort("timedout"));
  await page.goto("/concierge");
  await page.getByRole("button", { name: "PR 검토 시작" }).click();
  await expect(page.getByText("GitHub 연결 상태를 지금 확인할 수 없습니다.")).toBeVisible();
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "다른 GitHub 계정으로 로그인" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /GitHub로 계속하기/ })).toBeVisible();
});

test("a report keeps its evidence visible when durable logout fails and allows the same-session retry", async ({ page }) => {
  let deleteCalls = 0;
  await interceptSuccess(page);
  await page.route("**/api/auth/github/session", async (route) => {
    deleteCalls += 1;
    await route.fulfill(deleteCalls === 1
      ? { status: 503, contentType: "application/json", body: JSON.stringify({ deleted: false, code: "auth_unavailable" }) }
      : { status: 200, contentType: "application/json", body: JSON.stringify({ deleted: true }), headers: { "set-cookie": "__Host-agentproof-concierge-github-session=deleted; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" } });
  });
  await page.goto("/concierge");
  await fillAndRun(page);
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByLabel("PR 증거 보고서")).toBeVisible();
  await expect(page.getByLabel("PR 증거 보고서").getByRole("alert")).toContainText("로그아웃을 확인하지 못했습니다.");
  await expect(page.getByText("보고서는 그대로 유지했습니다. 같은 계정으로 다시 시도해 주세요.")).toBeVisible();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect.poll(() => deleteCalls).toBe(2);
  await expect(page.getByLabel("PR 증거 보고서")).toHaveCount(0);
});

test("organization-only access is explained without exposing identifiers", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true, authMethod: "github", repositoriesAvailable: false }) }));
  await page.route("**/api/auth/github/repositories", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: "app_missing", repositories: [] }) }));
  await page.goto("/concierge");
  await page.getByRole("button", { name: "PR 검토 시작" }).click();
  await expect(page.getByText("조직 저장소는 첫 베타에서 지원하지 않습니다.")).toBeVisible();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
  await expect(page.getByRole("button", { name: "다른 GitHub 계정으로 로그인" })).toBeVisible();
});

test("a personal App installation without a manual grant has distinct recovery guidance", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true, authMethod: "github", repositoriesAvailable: true }) }));
  await page.route("**/api/auth/github/repositories", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: "no_granted_personal_repository", repositories: [] }) }));
  await page.goto("/concierge");
  await page.getByRole("button", { name: "PR 검토 시작" }).click();
  await expect(page.getByText("아직 허용된 개인 저장소가 없습니다.")).toBeVisible();
  await expect(page.getByText("조직 저장소는 첫 베타에서 지원하지 않습니다.")).toHaveCount(0);
});

test("ready personal-repository selection exposes logout and account switching without IDs", async ({ page }) => {
  await page.goto("/concierge");
  await fillSetup(page);
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
  await expect(page.getByRole("button", { name: "다른 GitHub 계정으로 로그인" })).toBeVisible();
  await page.getByRole("button", { name: "로그아웃" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "다른 GitHub 계정으로 로그인" })).toBeFocused();
  await expect(page.getByLabel("베타 공간 ID")).toHaveCount(0);
});

test("revoked access gives bounded recovery controls", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ authenticated: true, authMethod: "github", repositoriesAvailable: true }) }));
  await page.route("**/api/auth/github/repositories", (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "installation_not_active" }) }));
  await page.goto("/concierge");
  await page.getByRole("button", { name: "PR 검토 시작" }).click();
  await expect(page.getByText("GitHub 접근 권한이 변경되었습니다.")).toBeVisible();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
  await expect(page.getByRole("button", { name: "다른 GitHub 계정으로 로그인" })).toBeVisible();
});

test("keyboard focus reaches the detail gateway and selected detail panels", async ({ page }) => {
  await interceptSuccess(page);
  await page.goto("/concierge");
  await fillAndRun(page);
  await expect(page.getByLabel("PR 증거 보고서")).toBeFocused();
  await tabUntil(page, page.getByRole("button", { name: /요구사항.*1개 항목의 구현 근거/ }));
  await page.keyboard.press("Enter");
  await expect(page.locator("#concierge-panel-requirements")).toBeFocused();
  await tabUntil(page, page.getByRole("button", { name: "테스트·CI" }));
  await page.keyboard.press("Enter");
  await expect(page.locator("#concierge-panel-checks")).toBeFocused();
});

test("mobile shows the review brief first without horizontal overflow", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await interceptSuccess(page);
  await page.goto("/concierge");
  await expect(page.locator(".welcome-scene .proof-buddy.hero")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await fillAndRun(page);
  await expect(page.getByRole("heading", { name: "요구사항 대상 테스트 증거 없음" })).toBeVisible();
  const briefBox = await page.locator(".friendly-brief").boundingBox();
  expect(briefBox?.y ?? 9999).toBeLessThan(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.close();
});

test("320px mobile keeps zero-gap feedback and reset controls operable without horizontal overflow", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 720 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await interceptSuccess(page, zeroGapFixture());
  await page.route("**/api/tenants/concierge/feedback", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stored: true, duplicate: false, privacy: "bounded-metadata-only" }) }));
  await page.goto("/concierge"); await fillSetup(page, { evaluation: true }); await page.getByRole("button", { name: "PR 근거 확인하기" }).click();
  await page.getByText("간단한 사용성 피드백", { exact: true }).click();
  await expect(page.getByLabel("우선 검토 항목을 찾았나요?")).toHaveValue("not_applicable_zero_gap");
  await page.getByText("운영자용 세부 기록", { exact: true }).click();
  await expect(page.getByRole("button", { name: "피드백 저장" })).toBeVisible();
  await expect(page.getByRole("button", { name: "새 PR 확인하기" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const box = await page.getByRole("button", { name: "새 PR 확인하기" }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.getByRole("button", { name: "피드백 저장" }).tap();
  await expect(page.getByText("피드백을 저장했습니다.")).toBeVisible();
  await page.getByRole("button", { name: "새 PR 확인하기" }).tap();
  await expect(page.getByLabel("PR 증거 보고서")).toHaveCount(0);
  await context.close();
});

test("zero-gap report shows bounded evidence language without fabricating a re-prompt", async ({ page }) => {
  await interceptSuccess(page, zeroGapFixture());
  await page.goto("/concierge"); await fillAndRun(page);
  await expect(page.getByRole("heading", { name: "우선 확인할 증거 공백을 찾지 못했습니다" })).toBeVisible();
  await expect(page.getByText(/이것이 구현의 정확성이나 완전성을 증명하지는 않습니다/)).toBeVisible();
  await expect(page.getByText(/병합 여부를 결정하거나 구현이 맞다고 보증하지 않습니다/)).toBeVisible();
  await expect(page.getByRole("button", { name: "후속 요청 복사" })).toHaveCount(0);
});

test("bounded feedback leaves cohort assignment to the server without sending report or repository content", async ({ page }) => {
  let feedbackBody: any = null;
  await interceptSuccess(page);
  await page.route("**/api/tenants/concierge/feedback", async (route) => {
    feedbackBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stored: true, duplicate: false, privacy: "bounded-metadata-only" }) });
  });
  await page.goto("/concierge"); await fillSetup(page, { evaluation: true }); await page.getByRole("button", { name: "PR 근거 확인하기" }).click();
  await page.getByText("간단한 사용성 피드백", { exact: true }).click();
  await page.getByText("운영자용 세부 기록", { exact: true }).click();
  await page.getByLabel("우선 검토 항목을 찾았나요?").selectOption("found_within_30s");
  await page.getByLabel("찾는 데 걸린 시간(초)").fill("12");
  await page.getByRole("button", { name: "피드백 저장" }).click();
  await expect(page.getByText("피드백을 저장했습니다.")).toBeVisible();
  expect(Object.keys(feedbackBody ?? {}).sort()).toEqual(["feedback"]);
  const feedback = (feedbackBody?.feedback ?? {}) as Record<string, unknown>;
  expect(feedback).toMatchObject({ schemaVersion: "concierge-feedback.v3", privacyNoticeVersion: "human-beta-privacy.v1", topGapOutcome: "found_within_30s", foundTopGapWithin30s: true, timeToTopGapSeconds: 12 });
  expect(feedback).not.toHaveProperty("participantCohort");
  const serialized = JSON.stringify(feedbackBody);
  expect(serialized).not.toContain("acme/private");
  expect(serialized).not.toContain("Synthetic private PR");
  expect(serialized).not.toContain("Inspect the cited deterministic evidence only.");
  expect(serialized).not.toContain("diff --git");
});

test("new PR control clears private report state", async ({ page }) => {
  await interceptSuccess(page);
  await page.goto("/concierge"); await fillAndRun(page);
  await page.getByRole("button", { name: "새 PR 확인하기" }).click();
  await expect(page.getByLabel("PR 증거 보고서")).toHaveCount(0);
  await expect(page.getByLabel("허용된 개인 저장소")).toHaveValue("acme/private");
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
});

test("unavailable, ambiguous, and failed-check fixtures never display met and retain bounded deterministic navigation", async ({ browser }) => {
  const cases = [
    { report: fixture("unavailable"), task: "요구사항 확인 불가: 연결된 GitHub Issue 없음", gap: "증거 수집 불가" },
    { report: fixture("ambiguous"), task: "요구사항 확인 불가: 연결된 GitHub Issue가 여러 개", gap: "증거 수집 불가" },
    { report: fixture("available", "passed", "evidence_insufficient"), task: "요구사항 GitHub Issue #42", gap: "수집된 증거 불충분" },
    { report: fixture("available", "failed"), task: "요구사항 GitHub Issue #42", gap: "테스트·빌드 실행 실패" }
  ];
  for (const { report, task, gap } of cases) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await interceptSuccess(page, report); await page.goto("/concierge"); await fillAndRun(page);
    await expect(page.getByLabel("PR 증거 보고서")).toBeVisible();
    await expect(page.getByText(task)).toBeVisible();
    await expect(page.getByRole("heading", { name: gap })).toBeVisible();
    await expect(page.getByRole("link").first()).toHaveAttribute("href", /github\.com\/acme\/private/);
    await page.getByRole("button", { name: /요구사항.*1개 항목의 구현 근거/ }).click();
    await expect(page.getByText("구현 증거 있음", { exact: true })).toHaveCount(0);
    await context.close();
  }
});

test("original-task failure reasons remain distinct instead of becoming one generic collection error", async ({ browser }) => {
  const cases = [
    ["linked_issue_inaccessible", "요구사항 확인 불가: 연결된 GitHub Issue 접근 불가"],
    ["linked_issue_deleted_or_empty", "요구사항 확인 불가: 연결된 GitHub Issue 내용 없음"],
    ["linked_reference_is_pull_request", "요구사항 확인 불가: 연결 참조가 Issue가 아닌 PR"]
  ] as const;
  for (const [reason, expected] of cases) {
    const report: any = fixture("unavailable");
    report.source.originalTask = { version: 1, status: "unavailable", sourceType: "linked_issue", sourceRef: "github_issue:42", reason };
    const context = await browser.newContext();
    const page = await context.newPage();
    await interceptSuccess(page, report);
    await page.goto("/concierge");
    await fillAndRun(page);
    await expect(page.getByText(expected, { exact: true })).toBeVisible();
    await context.close();
  }
});

test("GitHub-equivalent bounded failures show an error and do not create report or browser storage", async ({ page }) => {
  for (const code of ["401", "403", "404", "429", "500", "timeout"]) {
    await page.route("**/api/tenants/concierge/analyze", (route) => route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ code }) }));
    await page.goto("/concierge"); await fillAndRun(page);
    await expect(page.locator(".intake-error")).toContainText("PR 근거 확인을 완료하지 못했습니다.");
    await expect(page.getByLabel("PR 증거 보고서")).toHaveCount(0);
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
  await expect(page.locator(".intake-error")).toContainText("GitHub에서 PR 증거를 가져오지 못했습니다.");
  await expect(page.getByLabel("PR 증거 보고서")).toHaveCount(0);
  await expect(page.getByText(rawPrivateText)).toHaveCount(0);
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage), cache: performance.getEntriesByType("resource").map((entry) => entry.name) }))).toMatchObject({ local: [], session: [] });
});

test("320px error copy stays horizontal and gives a bounded next action", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 720 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.route("**/api/tenants/concierge/analyze", (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "session_invalid" }) }));
  await page.goto("/concierge");
  await fillAndRun(page);
  const body = page.locator(".intake-error-body");
  await expect(body).toContainText("GitHub 로그인이 필요합니다.");
  await expect(body).toContainText("GitHub로 다시 로그인");
  expect((await body.boundingBox())?.width ?? 0).toBeGreaterThan(180);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await context.close();
});
