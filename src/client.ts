export type JobStatus =
  | "PENDING"
  | "RUNNING"
  | "PAUSED"
  | "CANCELLED"
  | "COMPLETED";

export interface ColumnMetadata {
  name: string;
  type: "string" | "number" | "boolean" | "date";
  job_type: "enrichment" | "imputation";
  description?: string | null;
}

export interface SignedUrlResponse {
  url: string;
  sourceId: string;
}

export interface EnrichRequest {
  columns_metadata: ColumnMetadata[];
  key_columns?: string[] | null;
  key_column_description?: string | null;
  row_limit?: number | null;
}

export interface JobProgress {
  job_id: string;
  total_rows: number;
  rows_by_stage: Record<string, number>;
  started_at: string;
  status: JobStatus;
}

export interface EnrichmentResult {
  key: string;
  extracted_data: Record<string, unknown>;
  confidence?: Record<string, { score: number; reason: string }> | null;
  sources: string[];
  error?: string | null;
}

const TERMINAL: JobStatus[] = ["COMPLETED", "CANCELLED"];

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL.includes(status);
}

export class AmpleDataClient {
  constructor(private readonly baseUrl: string, private readonly token: string) {}

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }

  private async json<T>(path: string, init: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, init);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${init.method} ${path} failed (${res.status}): ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async createSignedUrl(length: number, headers: string[]): Promise<SignedUrlResponse> {
    return this.json<SignedUrlResponse>("/enrichment-signed-url", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ contentType: "text/csv", length, headers }),
    });
  }

  async uploadCsv(url: string, body: string): Promise<void> {
    const res = await fetch(url, {
      method: "PUT",
      body,
      headers: { "Content-Type": "text/csv" },
    });
    if (!res.ok) {
      throw new Error(`CSV upload failed (${res.status}): ${res.statusText}`);
    }
  }

  async enrich(sourceId: string, req: EnrichRequest): Promise<string> {
    const res = await this.json<{ job_id: string }>(
      `/sources/${sourceId}/enrich`,
      { method: "POST", headers: this.headers(), body: JSON.stringify(req) },
    );
    return res.job_id;
  }

  async getProgress(jobId: string): Promise<JobProgress> {
    return this.json<JobProgress>(`/jobs/${jobId}/progress`, {
      method: "GET",
      headers: this.headers(),
    });
  }

  async getResults(jobId: string): Promise<EnrichmentResult[]> {
    return this.json<EnrichmentResult[]>(`/jobs/${jobId}/results`, {
      method: "GET",
      headers: this.headers(),
    });
  }

  async cancel(jobId: string): Promise<void> {
    await this.json<{ message: string }>(`/jobs/${jobId}/cancel`, {
      method: "POST",
      headers: this.headers(),
    });
  }
}
