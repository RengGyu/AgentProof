import { after } from "next/server";
import { claimAnalysisJobById, DEFAULT_ANALYSIS_JOB_CI_DISCOVERY_MS } from "./analysis-jobs";
import { runClaimedAnalysisJob } from "./analysis-worker";
export function scheduleAnalysisJobWake(jobId: string, requestUrl: string) {
    if (process.env.VERCEL !== "1")
        return;
    try {
        const workerUrl = new URL("/api/ops/analysis-jobs/run", requestUrl).toString();
        after(async () => {
            try {
                await new Promise<void>((resolve) => setTimeout(resolve, DEFAULT_ANALYSIS_JOB_CI_DISCOVERY_MS));
                const claimed = await claimAnalysisJobById(jobId);
                if (claimed.job)
                    await runClaimedAnalysisJob(claimed.job, { requestUrl: workerUrl });
            }
            catch {
                // The daily cron recovers an unclaimed or expired job.
            }
        });
    }
    catch {
        // An unavailable post-response scheduler does not discard the queued job.
    }
}
