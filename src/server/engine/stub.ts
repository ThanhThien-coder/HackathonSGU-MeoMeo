// File tạm, xóa ở TH-10
import { createHash } from "node:crypto";
import { CONFIG } from "@/contracts";
import type {
  ClientStaticEngineResult,
  IngestSource,
  StaticEngineResult,
} from "@/contracts";
import fixtureJson from "./__fixtures__/shop-api.json";

const fixture = fixtureJson as unknown as StaticEngineResult;

export async function runEngine(
  src: IngestSource,
  signal?: AbortSignal,
): Promise<StaticEngineResult> {
  signal?.throwIfAborted();

  const result = structuredClone(fixture);
  result.engine_version = CONFIG.ENGINE_VERSION;

  if (src.kind === "ZIP_UPLOAD") {
    const hash = createHash("sha256").update(src.bytes).digest("hex");
    result.snapshot = {
      source: "ZIP",
      repo_key: src.file_name,
      snapshot_id: hash,
      snapshot_id_kind: "ARCHIVE_HASH",
      subdir: "",
      ref_label: null,
    };
  }

  return result;
}

export function toClientResult(
  r: StaticEngineResult,
): ClientStaticEngineResult {
  return {
    engine_version: r.engine_version,
    repo_name: r.repo_name,
    snapshot: r.snapshot,
    fingerprint: r.fingerprint,
    total_files: r.total_files,
    nodes: r.nodes,
    edges: r.edges,
    groups: r.groups,
    file_index: r.file_index,
    ingestion_report: {
      truncated: r.ingestion_report.truncated,
      selective_fetch: r.ingestion_report.selective_fetch,
      code_file_count: r.ingestion_report.code_file_count,
      manifest_count: r.ingestion_report.manifest_count,
      omitted_node_count: r.ingestion_report.omitted_node_count,
      skipped: r.ingestion_report.skipped,
      warnings: r.ingestion_report.warnings,
      degraded_mode: r.ingestion_report.degraded_mode,
      redacted_secret_count: r.ingestion_report.redacted_secret_count,
      engine_ms: r.ingestion_report.engine_ms,
      ingest_ms: r.ingestion_report.ingest_ms,
    },
  };
}
