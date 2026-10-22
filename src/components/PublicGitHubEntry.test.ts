import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceSignIn } from "./WorkspaceSignIn";
import { PublicGitHubEntry } from "./PublicGitHubEntry";

const source = readFileSync(new URL("./PublicGitHubEntry.tsx", import.meta.url), "utf8");

describe("PublicGitHubEntry", () => {
  it("starts the one GitHub sign-in, offers no signed-out PR analysis, and sends signed-in visitors to the dashboard", () => {
    expect(source).toContain('"/api/auth/github/start"');
    expect(source).not.toContain("/analyze");
    expect(source).not.toContain("Analyze a public PR");
    expect(source).toContain('"/api/dashboard/session"');
    expect(source).toContain('window.location.replace("/dashboard")');
  });

  it("does not ask users to supply a GitHub token on the entry screen", () => {
    expect(source).not.toContain("githubToken");
  });

  it("keeps report examples out of the GitHub sign-in screen", () => {
    expect(source).not.toContain("Evidence summary");
    expect(source).not.toContain("Pull request #14");
    expect(source).not.toContain("src/auth.ts");
  });

  it("offers the sample dashboard only when the server enables Preview demo mode", () => {
    expect(source).toContain("previewDemoAvailable");
    expect(source).toContain('href="/dashboard?demo=1"');
    expect(source).toContain("Preview dashboard");
  });

  it("renders one sign-in entry with the result boundary and no public analysis offer", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceSignIn, { message: "", onSignIn: async () => {} }));
    expect(html).toContain("Sign in to DiffEvidence");
    expect(html).toContain("Continue with GitHub");
    for (const removed of ["does not establish correctness", "to open your connected repositories", "Reports organize pull request evidence"]) expect(html).not.toContain(removed);
    expect(html).not.toMatch(/Analyze a public PR|\/analyze/);
  });
});


it("keeps one shared decorative brand mark in the entry and sign-in while preserving the home link", () => {
  const html = renderToStaticMarkup(createElement(PublicGitHubEntry));
  expect(html.match(/class="diffevidence-mark"/g)).toHaveLength(2);
  const home = html.match(/<a[^>]*class="dashboard-brand"[^>]*>/)?.[0];
  expect(home).toContain('href="/"');
  expect(home).toContain('aria-label="DiffEvidence home"');
  expect(html).toContain("DiffEvidence");
  // The supplied logo is decorative next to the name and keeps its 253:192 aspect ratio.
  for (const img of html.match(/<img[^>]*class="diffevidence-mark"[^>]*>/g) ?? []) {
    expect(img).toContain('src="/brand/diffevidence-mark.png"');
    expect(img).toContain('alt=""');
    expect(img).toContain('aria-hidden="true"');
    const [, width, height] = img.match(/width="(\d+)" height="(\d+)"/) ?? [];
    expect(Math.abs(Number(width) / Number(height) - 253 / 192)).toBeLessThan(0.03);
  }
  // Apart from the supplied logo image, the entry still renders no images, filters or scripts.
  expect(html.replace(/<img[^>]*class="diffevidence-mark"[^>]*>/g, "")).not.toMatch(/<img|<image|<filter|<script/);
});
it("shows the entry brand as the logo only, with its name kept as the accessible name", () => {
  const html = renderToStaticMarkup(createElement(PublicGitHubEntry));
  const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
  expect(header).toContain('aria-label="DiffEvidence home"');
  expect(header).toContain('title="DiffEvidence"');
  // The brand stays logo-only; the header's other control is the labelled sign-in button.
  const brand = header.slice(header.indexOf('<a'), header.indexOf('</a>'));
  expect(brand.replace(/<[^>]+>/g, "").trim()).toBe("");
});

describe("front door and first connection", () => {
  it("shows the value and sign-in, one fictional sample with code references, and the three start steps, with no public analysis", async () => {
    const html = renderToStaticMarkup(createElement(PublicGitHubEntry));
    for (const text of ["Understand a pull request’s purpose and key changes.", "Read a concise report with code references, related tests and GitHub CI results.", "Sample report · Fictional repository", "upload.ts:40–58", "upload.test.ts:12–30", "Model interpretation", "GitHub CI", "Get started", "Sign in with GitHub.", "Connect repositories.", "Install the GitHub App if needed.", "Choose a PR and generate its report."]) expect(html).toContain(text);
    // The long scope/limits section is not on the home page.
    for (const removed of ["What a report covers", "Does not", "How it connects"]) expect(html).not.toContain(removed);
    expect(html).not.toMatch(/\/analyze|Analyze a public PR|customers|trusted by/i);
    expect([...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map(m => m[1])).toEqual(["/"]);
    expect(html.match(/aria-busy="false"/g)?.length).toBe(3);
  });
  it("shows only the real action for each first-connection stage", async () => {
    const { ConnectRepositoryGuide } = await import("./PublicGitHubDashboard");
    const render = (stage: "install" | "reauth" | "installation" | "repository") => renderToStaticMarkup(createElement(ConnectRepositoryGuide, { stage, onInstall() {}, onConfirm() {} }));
    expect(render("install")).toContain("Add repositories");
    const reauth = render("reauth");
    expect(reauth).toContain("You are still signed in.");expect(reauth).toContain("Confirm with GitHub");expect(reauth).not.toContain("Add repositories");
    for (const stage of ["installation", "repository"] as const) expect(render(stage)).not.toContain("<button");
    expect(render("install")).toContain('aria-current="step"');
  });
});
