import type { DashboardReportDetail } from "./github-dashboard-view-model";

type CopyDetail = DashboardReportDetail & { repositoryFullName?: string };

export async function prepareCurrentDashboardDetailForCopy(input: {
  id: string;
  repositoryFullName: string;
  fetchDetail: (id: string) => Promise<DashboardReportDetail | null>;
}): Promise<CopyDetail> {
  const detail = await input.fetchDetail(input.id);
  if (!isCurrentCopyDetail(detail)) throw new Error("Dashboard report is not current and copy eligible.");
  return { ...detail, repositoryFullName: input.repositoryFullName };
}

export async function copyRevalidatedDashboardDetail(input: {
  id: string;
  repositoryFullName: string;
  fetchDetail: (id: string) => Promise<DashboardReportDetail | null>;
  writeText: (value: string) => Promise<void>;
  toText: (detail: CopyDetail) => string;
}): Promise<void> {
  const detail = await prepareCurrentDashboardDetailForCopy(input);
  await input.writeText(input.toText(detail));
}

export async function prepareCurrentDashboardBundleForCopy(input: {
  repositoryId: number;
  repositoryFullName: string;
  fetchBundle: () => Promise<{ bundle?: { complete?: unknown; truncated?: unknown }; reports?: unknown } | null>;
}): Promise<CopyDetail[]> {
  const bundle = await input.fetchBundle();
  if (bundle?.bundle?.complete !== true || bundle.bundle?.truncated === true || !Array.isArray(bundle.reports)) {
    throw new Error("Dashboard report bundle is incomplete.");
  }
  const details = bundle.reports.filter(isCurrentCopyDetail);
  if (details.length !== bundle.reports.length || details.length === 0 || details.some((detail) => detail.repositoryId !== input.repositoryId)) {
    throw new Error("Dashboard report bundle is not current.");
  }
  return details.map((detail) => ({ ...detail, repositoryFullName: input.repositoryFullName }));
}

function isCurrentCopyDetail(value: unknown): value is DashboardReportDetail {
  return Boolean(value) && typeof value === "object" &&
    (value as DashboardReportDetail).freshness === "current" &&
    (value as DashboardReportDetail).copyEligible === true &&
    Boolean((value as DashboardReportDetail).report);
}
