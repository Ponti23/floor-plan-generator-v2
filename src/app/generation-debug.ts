/**
 * Opt-in developer detail for a finished job (S10). Only shown when the service
 * runs with PLANLAB_DEBUG=1 and the user opens the disclosure: the normal
 * workflow never shows correlation ids, timings or engine diagnostics.
 */
import type { JobV1, LayoutV1, ProblemV1 } from "../integration/contracts.ts";

export interface DebugSection {
  title: string;
  rows: { label: string; value: string }[];
}

export function debugEnabled(search: string): boolean {
  return new URLSearchParams(search).get("debug") === "1";
}

export function buildDebugSections(
  job: JobV1 | null,
  layouts: LayoutV1[],
  problem: ProblemV1 | null,
  diagnostics: Record<string, unknown> | null = null,
): DebugSection[] {
  if (!job) {
    return [];
  }
  const sections: DebugSection[] = [
    {
      title: "Job",
      rows: [
        { label: "generationId", value: job.generationId },
        { label: "briefVersionId", value: job.briefVersionId },
        { label: "briefHash", value: job.briefHash },
        { label: "status", value: job.status },
        { label: "stateVersion", value: String(job.stateVersion) },
        { label: "elapsedMs", value: String(job.elapsedMs) },
      ],
    },
  ];
  if (job.versions) {
    sections.push({
      title: "Engine",
      rows: [
        { label: "engineVersion", value: job.versions.engineVersion },
        { label: "checkpointId", value: job.versions.checkpointId },
        { label: "checkpointSha256", value: job.versions.checkpointSha256 },
        { label: "vocabularySha256", value: job.versions.vocabularySha256 },
        { label: "torchVersion", value: job.versions.torchVersion },
        { label: "ortoolsVersion", value: job.versions.ortoolsVersion },
      ],
    });
  }
  if (problem) {
    sections.push({
      title: "Problem",
      rows: [
        { label: "code", value: problem.code },
        { label: "category", value: problem.category },
        { label: "proof", value: String(problem.proof) },
        { label: "retryable", value: String(problem.retryable) },
        { label: "correlationId", value: problem.correlationId },
      ],
    });
  }
  for (const layout of layouts) {
    sections.push({
      title: `Option ${layout.rank}`,
      rows: [
        { label: "layoutId", value: layout.layoutId },
        { label: "solverStatus", value: layout.solverStatus },
        { label: "coordinateSystem", value: layout.coordinateSystem },
        { label: "topologyCandidateId", value: layout.provenance.topologyCandidateId },
        { label: "attempts", value: String(layout.provenance.attempts) },
        { label: "seed", value: String(layout.provenance.seed) },
        { label: "checks", value: `${layout.validation.checks.length} passed` },
      ],
    });
  }
  if (diagnostics) {
    sections.push({
      title: "Diagnostics",
      rows: Object.entries(diagnostics).map(([key, value]) => ({
        label: key,
        value: typeof value === "string" ? value : JSON.stringify(value),
      })),
    });
  }
  return sections;
}
