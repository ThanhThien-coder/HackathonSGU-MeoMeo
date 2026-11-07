import { CONFIG } from "@/contracts/config";
import type {
  GuardCall,
  GuardCode,
  GuardIssue,
  GuardLogEntry,
} from "@/contracts";
import { logGuardBlocked } from "@/server/log";

export function logGuardBlock(
  call: GuardCall,
  attempt: number,
  nodeId: string | null,
  issues: GuardIssue[],
): void {
  const codes: GuardCode[] = [...new Set(issues.map((i) => i.code))];
  const entry: GuardLogEntry = {
    event: "guard_blocked",
    call,
    attempt,
    node_id: nodeId,
    codes,
    prompt_version: CONFIG.PROMPT_VERSION,
    llm_model: CONFIG.LLM_MODEL,
  };
  logGuardBlocked(entry);
}
