import { Actor, log } from "apify";
import { parse } from "csv-parse/sync";
import {
  AmpleDataClient,
  ColumnMetadata,
  EnrichmentResult,
  isTerminal,
  JobProgress,
} from "./client.js";

interface Input {
  apiToken?: string;
  csv?: string;
  csvUrl?: string;
  columns: Array<{ name: string; type?: ColumnMetadata["type"]; description?: string }>;
  keyColumns?: string[];
  keyColumnDescription?: string;
  rowLimit?: number;
  baseUrl?: string;
  pollIntervalSecs?: number;
}

const DEFAULT_BASE_URL = "https://api.ampledata.ai/api/v1";

function resolveToken(input: Input): string {
  const token = input.apiToken || process.env.AMPLEDATA_KEY;
  if (!token) {
    throw new Error("No API key: provide `apiToken` input or set the AMPLEDATA_KEY env var");
  }
  return token;
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function resolveCsv(input: Input): Promise<string> {
  if (input.csvUrl) {
    const res = await fetch(input.csvUrl);
    if (!res.ok) throw new Error(`Failed to download CSV (${res.status})`);
    return res.text();
  }
  if (input.csv) return input.csv;
  throw new Error("Provide either `csv` or `csvUrl`");
}

function parseHeaders(csv: string): string[] {
  const rows = parse(csv, { toLine: 1 }) as string[][];
  if (!rows.length || !rows[0].length) throw new Error("CSV has no header row");
  return rows[0];
}

function buildColumns(input: Input): ColumnMetadata[] {
  if (!input.columns?.length) throw new Error("`columns` must not be empty");
  return input.columns.map((c) => ({
    name: c.name,
    type: c.type ?? "string",
    job_type: "enrichment",
    description: c.description ?? null,
  }));
}

function registerCancel(client: AmpleDataClient, jobId: string): void {
  Actor.on("aborting", async () => {
    log.warning(`Run aborting — cancelling AmpleData job ${jobId}`);
    try {
      await client.cancel(jobId);
      log.info(`Job ${jobId} cancelled`);
    } catch (err) {
      log.exception(err as Error, "Failed to cancel job");
    }
  });
}

async function waitForJob(
  client: AmpleDataClient,
  jobId: string,
  intervalSecs: number,
): Promise<JobProgress> {
  for (;;) {
    const progress = await client.getProgress(jobId);
    log.info(`Job ${jobId}: ${progress.status}`, progress.rows_by_stage);
    if (isTerminal(progress.status)) return progress;
    await sleep(intervalSecs);
  }
}

async function startJob(client: AmpleDataClient, input: Input, csv: string): Promise<string> {
  const headers = parseHeaders(csv);
  const { url, sourceId } = await client.createSignedUrl(Buffer.byteLength(csv, "utf8"), headers);
  await client.uploadCsv(url, csv);
  log.info(`Uploaded CSV to source ${sourceId}`);
  return client.enrich(sourceId, {
    columns_metadata: buildColumns(input),
    key_columns: input.keyColumns ?? null,
    key_column_description: input.keyColumnDescription ?? null,
    row_limit: input.rowLimit ?? null,
  });
}

async function pushResults(client: AmpleDataClient, jobId: string): Promise<EnrichmentResult[]> {
  const results = await client.getResults(jobId);
  await Actor.pushData(results);
  return results;
}

await Actor.main(async () => {
  const input = (await Actor.getInput<Input>()) ?? ({} as Input);
  const token = resolveToken(input);

  const client = new AmpleDataClient(input.baseUrl ?? DEFAULT_BASE_URL, token);
  const csv = await resolveCsv(input);

  const jobId = await startJob(client, input, csv);
  log.info(`Started enrichment job ${jobId}`);
  registerCancel(client, jobId);

  const final = await waitForJob(client, jobId, input.pollIntervalSecs ?? 5);
  const results = final.status === "COMPLETED" ? await pushResults(client, jobId) : [];

  await Actor.setValue("OUTPUT", {
    jobId,
    status: final.status,
    totalRows: final.total_rows,
    resultCount: results.length,
  });
  log.info(`Done. Job ${jobId} ${final.status} with ${results.length} results`);
});
