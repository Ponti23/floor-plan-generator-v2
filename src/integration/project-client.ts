/**
 * Typed client for the PlanLab generation service. Every mutation carries the
 * `X-PlanLab-Client: 1` header the service requires; server problems are parsed
 * into their ProblemV1 shape instead of being flattened into a generic error.
 */
import {
  CONTRACT_VERSION,
  type BriefV1,
  type EditorDocumentV2,
  type GenerationRequestV1,
  type JobV1,
  type LayoutV1,
  type ProblemV1,
  type ProjectV1,
} from "./contracts.ts";

export class EngineApiError extends Error {
  readonly status: number;
  readonly problem: ProblemV1 | null;

  constructor(status: number, problem: ProblemV1 | null, message?: string) {
    super(message ?? problem?.message ?? `request failed with status ${status}`);
    this.name = "EngineApiError";
    this.status = status;
    this.problem = problem;
  }

  get retryable(): boolean {
    return this.problem?.retryable ?? (this.status >= 500 || this.status === 429);
  }

  get category(): ProblemV1["category"] | "unknown" {
    return this.problem?.category ?? "unknown";
  }
}

export interface ProjectDetailV1 extends ProjectV1 {
  brief: BriefV1 | null;
  editorDocument: EditorDocumentV2 | null;
  selectedLayout: LayoutV1 | null;
  activeGenerationId: string | null;
}

export interface ProjectClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class ProjectClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ProjectClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    mutation = false,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (mutation) {
      headers.set("X-PlanLab-Client", "1");
      headers.set("Content-Type", "application/json");
    }
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (!response.ok) {
      const problem =
        parsed && typeof parsed === "object" && "error" in (parsed as Record<string, unknown>)
          ? ((parsed as { error: ProblemV1 }).error ?? null)
          : null;
      throw new EngineApiError(response.status, problem);
    }
    return parsed as T;
  }

  health(): Promise<{ status: string; reason?: string }> {
    return this.request("/api/v1/health/ready");
  }

  createProject(name: string): Promise<ProjectV1> {
    return this.request(
      "/api/v1/projects",
      { method: "POST", body: JSON.stringify({ name }) },
      true,
    );
  }

  listProjects(limit = 20): Promise<{ items: ProjectV1[]; nextCursor: string | null }> {
    return this.request(`/api/v1/projects?limit=${limit}`);
  }

  getProject(projectId: string): Promise<ProjectDetailV1> {
    return this.request(`/api/v1/projects/${projectId}`);
  }

  saveBriefVersion(
    projectId: string,
    expectedProjectRevision: number,
    brief: BriefV1,
    editorDocument: EditorDocumentV2,
  ): Promise<{ briefVersionId: string; briefHash: string; projectRevision: number }> {
    return this.request(
      `/api/v1/projects/${projectId}/brief-versions`,
      {
        method: "POST",
        body: JSON.stringify({ expectedProjectRevision, brief, editorDocument }),
      },
      true,
    );
  }

  createGeneration(request: GenerationRequestV1): Promise<JobV1> {
    return this.request(
      "/api/v1/generations",
      { method: "POST", body: JSON.stringify(request) },
      true,
    );
  }

  getGeneration(generationId: string, signal?: AbortSignal): Promise<JobV1> {
    return this.request(`/api/v1/generations/${generationId}`, { signal });
  }

  cancelGeneration(generationId: string): Promise<JobV1> {
    return this.request(
      `/api/v1/generations/${generationId}/cancel`,
      { method: "POST", body: "{}" },
      true,
    );
  }

  getLayouts(generationId: string): Promise<{ generationId: string; status: string; layouts: LayoutV1[] }> {
    return this.request(`/api/v1/generations/${generationId}/layouts`);
  }

  getLayout(layoutId: string): Promise<LayoutV1> {
    return this.request(`/api/v1/layouts/${layoutId}`);
  }

  putSelection(
    projectId: string,
    layoutId: string,
    expectedProjectRevision: number,
  ): Promise<{
    projectId: string; layoutId: string; generationId: string;
    briefVersionId: string; projectRevision: number; selectedAt: string;
  }> {
    return this.request(
      `/api/v1/projects/${projectId}/selection`,
      { method: "PUT", body: JSON.stringify({ layoutId, expectedProjectRevision }) },
      true,
    );
  }

  static generationRequest(
    projectId: string,
    briefVersionId: string,
    idempotencyKey: string,
  ): GenerationRequestV1 {
    return {
      schemaVersion: CONTRACT_VERSION,
      projectId,
      briefVersionId,
      idempotencyKey,
    };
  }
}
