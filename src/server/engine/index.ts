import type { IngestSource, StaticEngineResult } from "@/contracts";
import { buildGraph } from "./graph";
import { runIngest } from "./ingest";

export { toClientResult } from "./graph";

export async function runEngine(
  src: IngestSource,
  signal?: AbortSignal,
): Promise<StaticEngineResult> {
  const ingested = await runIngest(src, signal);
  signal?.throwIfAborted();
  return buildGraph(ingested);
}
