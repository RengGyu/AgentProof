export type TenantDataRetentionPolicyStatus = "draft";

export type TenantDataDeletionReadiness =
  | "not-applicable"
  | "ready"
  | "manual-review-required"
  | "blocked";

export type TenantDataRetentionCategoryKey =
  | "transient_pr_evidence"
  | "saved_reports"
  | "repository_grants"
  | "github_installations"
  | "onboarding_states"
  | "webhook_deliveries"
  | "analysis_jobs"
  | "audit_events"
  | "usage_records"
  | "account_member_records"
  | "billing_account_records"
  | "backups"
  | "tenant_tombstones";

export type TenantDeletionPreviewCountedCategoryKey = Extract<
  TenantDataRetentionCategoryKey,
  "saved_reports" | "repository_grants" | "github_installations" | "webhook_deliveries" | "analysis_jobs" | "audit_events" | "usage_records"
>;

export interface TenantDataRetentionPolicyCategory {
  key: TenantDataRetentionCategoryKey;
  label: string;
  storedFields: string;
  prohibitedFields: string;
  retention: string;
  deletionBehavior: string;
  backupBehavior: string;
  retentionWindowDays: number;
  retentionWindowTrigger: string;
  deletionMode: "not-stored" | "ttl-only" | "automatic" | "manual-review" | "tombstone";
  deletionReadiness: TenantDataDeletionReadiness;
  deletionBlockers: readonly string[];
  previewCounting: "counted" | "not-counted" | "not-stored";
}

export interface TenantRetentionDeletionPlanCategory {
  key: TenantDataRetentionCategoryKey;
  deletionMode: TenantDataRetentionPolicyCategory["deletionMode"];
  deletionReadiness: TenantDataDeletionReadiness;
  retentionWindowDays: number;
  retentionWindowTrigger: string;
  deletionBlockers: readonly string[];
}

export interface TenantRetentionPolicyCoverage {
  countedCategories: TenantDeletionPreviewCountedCategoryKey[];
  uncountedCategories: Array<{
    key: TenantDataRetentionCategoryKey;
    reason: "not-stored" | "not-yet-counted";
  }>;
  totalCategories: number;
}

export const TENANT_DATA_RETENTION_POLICY = {
  version: "2026-06-30-concrete-windows-draft",
  status: "draft" as const,
  note: "Review the documented retention policy before destructive deletion.",
  categories: [
    {
      key: "transient_pr_evidence",
      label: "Transient PR evidence",
      storedFields: "In-request normalized GitHub evidence used to generate a verification report.",
      prohibitedFields: "Long-term raw diffs, logs, PR bodies, evidence indexes, claims, raw re-prompts, or tokens.",
      retention: "Request lifetime only unless the user explicitly exports Markdown or posts a comment.",
      deletionBehavior: "No durable tenant deletion step because the data is not persisted by design.",
      backupBehavior: "Not included in backups.",
      retentionWindowDays: 0,
      retentionWindowTrigger: "Request completion; raw PR evidence is not durably stored.",
      deletionMode: "not-stored",
      deletionReadiness: "not-applicable",
      deletionBlockers: [],
      previewCounting: "not-stored"
    },
    {
      key: "saved_reports",
      label: "Saved summary reports",
      storedFields: "Summary-only report projection, timestamps, tenant id, and hashed report access key when tenant-scoped.",
      prohibitedFields: "Evidence index, claims, raw re-prompt, raw report key, raw patch excerpts, raw logs, annotations, or secrets.",
      retention: "Short-lived TTL for reviewer handoff; expired rows are eligible for cleanup.",
      deletionBehavior: "Delete tenant-owned summary rows and their hashed access keys.",
      backupBehavior: "Restore only summary-only rows; never restore raw evidence because it is not stored.",
      retentionWindowDays: 1,
      retentionWindowTrigger: "Saved-report created_at/expires_at TTL.",
      deletionMode: "automatic",
      deletionReadiness: "ready",
      deletionBlockers: [],
      previewCounting: "counted"
    },
    {
      key: "repository_grants",
      label: "Repository grants",
      storedFields: "Tenant id, installation id, repository id/full name, enabled settings, timestamps.",
      prohibitedFields: "Installation tokens, repository source, diffs, logs, reports, webhook payloads, or private keys.",
      retention: "Active until disabled, installation removed, repository removed, or tenant deletion starts.",
      deletionBehavior: "Delete durable grant rows; env-backed demo grants require manual config removal.",
      backupBehavior: "May be present in metadata backups until backup expiry.",
      retentionWindowDays: 0,
      retentionWindowTrigger: "Tenant deletion start, repository removal, or installation disconnect.",
      deletionMode: "manual-review",
      deletionReadiness: "manual-review-required",
      deletionBlockers: ["Env-backed demo grants require manual configuration removal."],
      previewCounting: "counted"
    },
    {
      key: "github_installations",
      label: "GitHub installations",
      storedFields: "Installation/account metadata needed to map a GitHub App installation to a tenant.",
      prohibitedFields: "Installation access tokens, private keys, webhook payloads, repository contents, diffs, or logs.",
      retention: "Active while the installation is connected; lifecycle events disable dependent grants.",
      deletionBehavior: "Revoke or disconnect installation where possible, then remove local metadata.",
      backupBehavior: "Metadata can exist in backups until backup expiry.",
      retentionWindowDays: 0,
      retentionWindowTrigger: "Tenant deletion start after external GitHub installation revocation or disconnect review.",
      deletionMode: "manual-review",
      deletionReadiness: "manual-review-required",
      deletionBlockers: ["External GitHub installation revocation or disconnect confirmation is not automated."],
      previewCounting: "counted"
    },
    {
      key: "onboarding_states",
      label: "Onboarding states",
      storedFields: "Tenant id, hashed state, nonce metadata, expiration, and bounded activation state.",
      prohibitedFields: "Invite tokens, raw OAuth secrets, private keys, repository source, diffs, logs, or reports.",
      retention: "Short TTL for install callback completion.",
      deletionBehavior: "Delete expired or tenant-owned onboarding rows.",
      backupBehavior: "Not needed for restore once expired.",
      retentionWindowDays: 1,
      retentionWindowTrigger: "Onboarding state expires_at plus cleanup grace.",
      deletionMode: "ttl-only",
      deletionReadiness: "ready",
      deletionBlockers: [],
      previewCounting: "not-counted"
    },
    {
      key: "webhook_deliveries",
      label: "Webhook deliveries",
      storedFields: "Hashed idempotency keys and bounded delivery metadata.",
      prohibitedFields: "Raw webhook bodies, signatures, installation tokens, PR bodies, diffs, logs, reports, or secrets.",
      retention: "Bounded operational duplicate-suppression window.",
      deletionBehavior: "Delete tenant-mapped delivery metadata after retention or tenant deletion.",
      backupBehavior: "May be included only as bounded operational metadata.",
      retentionWindowDays: 7,
      retentionWindowTrigger: "Webhook delivery created_at/expires_at duplicate-suppression TTL.",
      deletionMode: "automatic",
      deletionReadiness: "ready",
      deletionBlockers: [],
      previewCounting: "counted"
    },
    {
      key: "analysis_jobs",
      label: "Analysis jobs",
      storedFields: "Tenant/job metadata, status, bounded error code/summary, planned side effects, and result summary.",
      prohibitedFields: "Raw webhook bodies, PR titles/bodies, diffs, logs, full reports, evidence indexes, claims, re-prompts, URLs with keys, or tokens.",
      retention: "Operational queue retention until completion cleanup or dead-letter review.",
      deletionBehavior: "Block new work, require active queued/processing/retryable jobs to drain or be manually cancelled, then delete terminal/completed tenant-owned rows through the guarded purge primitive.",
      backupBehavior: "Restore bounded metadata only when needed for operational recovery.",
      retentionWindowDays: 30,
      retentionWindowTrigger: "Job terminal/completed updated_at; active tenant deletion blocks new work while queued, processing, or retryable jobs drain or receive manual cancellation.",
      deletionMode: "automatic",
      deletionReadiness: "manual-review-required",
      deletionBlockers: [
        "Active queued, processing, or retryable jobs must drain or be manually cancelled before the guarded purge can complete."
      ],
      previewCounting: "counted"
    },
    {
      key: "audit_events",
      label: "Audit events",
      storedFields: "Bounded actor, tenant, repository, action, result, status, request prefix, and safe summary fields.",
      prohibitedFields: "Raw payloads, reports, diffs, logs, evidence indexes, claims, re-prompts, comment bodies, saved-link keys, or secrets.",
      retention: "Longer operational/compliance retention, still bounded metadata only.",
      deletionBehavior: "Retain or tombstone according to legal/compliance policy; do not expose raw customer evidence.",
      backupBehavior: "May be retained in backups until backup expiry.",
      retentionWindowDays: 365,
      retentionWindowTrigger: "Audit event created_at unless legal/compliance review requires a tombstone.",
      deletionMode: "manual-review",
      deletionReadiness: "manual-review-required",
      deletionBlockers: ["Compliance retention review is required before deleting or tombstoning audit rows."],
      previewCounting: "counted"
    },
    {
      key: "usage_records",
      label: "Usage records",
      storedFields: "Tenant id, period, feature, and hashed idempotency key.",
      prohibitedFields: "Raw idempotency keys, delivery ids, PR data, repository payloads, reports, diffs, logs, or tokens.",
      retention: "Billing and abuse-prevention retention window.",
      deletionBehavior: "Delete tenant-owned non-billing usage rows; billing-linked records may require manual review.",
      backupBehavior: "May be retained in backups until backup expiry.",
      retentionWindowDays: 400,
      retentionWindowTrigger: "Usage period end; billing-linked rows require plan/account review.",
      deletionMode: "manual-review",
      deletionReadiness: "manual-review-required",
      deletionBlockers: ["Billing-linked usage rows require manual review before deletion."],
      previewCounting: "counted"
    },
    {
      key: "account_member_records",
      label: "Account and member records",
      storedFields: "Tenant id, display name, status, plan label, member ids, roles, and member statuses.",
      prohibitedFields: "Raw invite tokens, session hashes, OAuth access or refresh tokens, contact details, billing provider ids, payment data, reports, diffs, logs, claims, re-prompts, or secrets.",
      retention: "Active while the tenant account exists; removal requires role/session/invite lifecycle review.",
      deletionBehavior: "Delete or tombstone tenant-owned account/member metadata after access revocation and legal review.",
      backupBehavior: "May exist in metadata backups until backup expiry.",
      retentionWindowDays: 0,
      retentionWindowTrigger: "Tenant deletion start after member sessions and invites are revoked.",
      deletionMode: "manual-review",
      deletionReadiness: "manual-review-required",
      deletionBlockers: ["Full account/member auth, invite revocation, and server-side session revocation are not implemented."],
      previewCounting: "not-counted"
    },
    {
      key: "billing_account_records",
      label: "Billing and account records",
      storedFields: "Tenant/account ids, plan, subscription status, provider customer id, invoice references, and deletion state.",
      prohibitedFields: "Payment card data, raw provider webhook bodies, source code, reports, diffs, logs, or tokens.",
      retention: "Legal, tax, and dispute retention window.",
      deletionBehavior: "Anonymize or retain minimum required billing records according to legal policy.",
      backupBehavior: "May remain in backups until backup expiry.",
      retentionWindowDays: 2555,
      retentionWindowTrigger: "Invoice, subscription, or tax event date.",
      deletionMode: "manual-review",
      deletionReadiness: "manual-review-required",
      deletionBlockers: ["Billing provider deletion/anonymization flow and legal retention policy are not implemented."],
      previewCounting: "not-counted"
    },
    {
      key: "backups",
      label: "Backups",
      storedFields: "Snapshot copies of allowed metadata and summary-only records.",
      prohibitedFields: "Raw evidence categories that production storage is prohibited from keeping.",
      retention: "Finite backup expiry window.",
      deletionBehavior: "Do not surgically edit immutable backups; delete or expire according to backup retention.",
      backupBehavior: "This is the backup category.",
      retentionWindowDays: 30,
      retentionWindowTrigger: "Backup creation date.",
      deletionMode: "ttl-only",
      deletionReadiness: "blocked",
      deletionBlockers: ["Backup expiry procedure and restore drill are not implemented or tested."],
      previewCounting: "not-counted"
    },
    {
      key: "tenant_tombstones",
      label: "Deleted-tenant tombstones",
      storedFields: "Tenant id hash or minimal deletion marker, deletion timestamp, and reason/status.",
      prohibitedFields: "Repository names, PR numbers, reports, diffs, logs, evidence, claims, re-prompts, billing details, or tokens.",
      retention: "Minimum period needed to prevent accidental reactivation and support deletion audits.",
      deletionBehavior: "Create during destructive deletion after policy approval.",
      backupBehavior: "May remain in backups until backup expiry.",
      retentionWindowDays: 365,
      retentionWindowTrigger: "Tenant deletion completed_at.",
      deletionMode: "tombstone",
      deletionReadiness: "blocked",
      deletionBlockers: ["Destructive deletion and tombstone creation workflow is not implemented."],
      previewCounting: "not-counted"
    }
  ] satisfies TenantDataRetentionPolicyCategory[]
} as const;

export function getTenantRetentionPolicyCoverage(
  countedCategories: TenantDeletionPreviewCountedCategoryKey[]
): TenantRetentionPolicyCoverage {
  const counted = new Set<TenantDataRetentionCategoryKey>(countedCategories);

  return {
    countedCategories,
    uncountedCategories: TENANT_DATA_RETENTION_POLICY.categories
      .filter((category) => !counted.has(category.key))
      .map((category) => ({
        key: category.key,
        reason: category.previewCounting === "not-stored" ? "not-stored" : "not-yet-counted"
      })),
    totalCategories: TENANT_DATA_RETENTION_POLICY.categories.length
  };
}

export function getTenantRetentionDeletionPlan(): TenantRetentionDeletionPlanCategory[] {
  return TENANT_DATA_RETENTION_POLICY.categories.map((category) => ({
    key: category.key,
    deletionMode: category.deletionMode,
    deletionReadiness: category.deletionReadiness,
    retentionWindowDays: category.retentionWindowDays,
    retentionWindowTrigger: category.retentionWindowTrigger,
    deletionBlockers: category.deletionBlockers
  }));
}
