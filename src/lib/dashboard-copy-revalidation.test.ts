import { describe, expect, it, vi } from "vitest";
import {
  copyRevalidatedDashboardDetail,
  prepareCurrentDashboardBundleForCopy,
  prepareCurrentDashboardDetailForCopy
} from "./dashboard-copy-revalidation";
import { dashboardReportToJson, dashboardReportToMarkdown } from "./dashboard-report-export";

const currentDetail = {
  id: "report_1",
  repositoryId: 100,
  pullRequestNumber: 10,
  freshness: "current" as const,
  copyEligible: true,
  report: { requirements: [] }
};

describe("dashboard copy revalidation", () => {
  it("re-fetches detail for every copy attempt and rejects a newer refreshing state after clipboard failure", async () => {
    const fetchDetail = vi.fn()
      .mockResolvedValueOnce(currentDetail)
      .mockResolvedValueOnce({ ...currentDetail, freshness: "refreshing" as const, copyEligible: false });
    const clipboard = vi.fn().mockRejectedValueOnce(new Error("blocked"));

    await expect(copyRevalidatedDashboardDetail({
      id: "report_1",
      repositoryFullName: "RengGyu/AgentProof",
      fetchDetail,
      writeText: clipboard,
      toText: (detail) => detail.repositoryFullName ?? "missing"
    })).rejects.toThrow("blocked");
    await expect(copyRevalidatedDashboardDetail({
      id: "report_1",
      repositoryFullName: "RengGyu/AgentProof",
      fetchDetail,
      writeText: clipboard,
      toText: (detail) => detail.repositoryFullName ?? "missing"
    })).rejects.toThrow("not current");
    expect(fetchDetail).toHaveBeenCalledTimes(2);
    expect(clipboard).toHaveBeenCalledTimes(1);
  });

  it("preserves only the authorized repository label for revalidated Markdown and JSON details", async () => {
    const detail = await prepareCurrentDashboardDetailForCopy({
      id: "report_1",
      repositoryFullName: "RengGyu/AgentProof",
      fetchDetail: async () => currentDetail
    });

    expect(detail.repositoryFullName).toBe("RengGyu/AgentProof");
    expect(dashboardReportToMarkdown(detail)).toContain("**Repository:** RengGyu/AgentProof");
    expect(JSON.parse(dashboardReportToJson(detail)).repository).toBe("RengGyu/AgentProof");
  });

  it("revalidates complete bulk bundles and fails closed on a truncated or stale response", async () => {
    const fetchBundle = vi.fn()
      .mockResolvedValueOnce({ bundle: { complete: true, truncated: false }, reports: [currentDetail] })
      .mockResolvedValueOnce({ bundle: { complete: false, truncated: true }, reports: [currentDetail] });

    await expect(prepareCurrentDashboardBundleForCopy({
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      fetchBundle
    })).resolves.toEqual([expect.objectContaining({ repositoryFullName: "RengGyu/AgentProof" })]);
    await expect(prepareCurrentDashboardBundleForCopy({
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      fetchBundle
    })).rejects.toThrow("incomplete");
    expect(fetchBundle).toHaveBeenCalledTimes(2);
  });
});
