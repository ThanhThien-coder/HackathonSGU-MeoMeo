import type {
  ClientStaticEngineResult,
  GraphEdge,
  HybridArchitecturalNode,
  NodeStateView,
  NodeStatus,
  RepoOverviewView,
  SessionProgress,
} from "@/contracts";
import { deriveNodeStates } from "@/lib/derive";

/** Phần trạng thái node mà bản đồ bài học cần (đủ cho cả bản suy ra ở client). */
export type NodeStateLite = Pick<NodeStateView, "node_id" | "status" | "has_warning" | "analysis_failed">;
export type NodeStates = Record<string, NodeStateLite>;

type MapNode = Pick<HybridArchitecturalNode, "id" | "prerequisites">;
type MapEdge = Pick<GraphEdge, "source" | "target">;

export interface LessonGroupView {
  group_id: string;
  /** Bản thi cắt AI tổng quan (B06) ⇒ tên nhóm luôn là `key` của engine. */
  name: string;
  key_kind: ClientStaticEngineResult["groups"][number]["key_kind"];
  node_ids: string[];
  /** Nhóm chứa bài đầu của đường chính ⇒ nhãn "★ Nên học trước" (D-84). */
  recommended: boolean;
}

/**
 * ENG-155: đường dài nhất trên DAG (DP theo thứ tự tô-pô Kahn), hòa theo `id` nhỏ hơn.
 * Trả `id` từ gốc tới cuối, rỗng ⇒ `[]`. Hàm thuần, chỉ đọc `nodes` và `edges`.
 */
export function mainPathOf(nodes: MapNode[], edges: MapEdge[]): string[] {
  const ids = new Set(nodes.map((n) => n.id));
  const parents = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const id of ids) {
    parents.set(id, []);
    indegree.set(id, 0);
    children.set(id, []);
  }
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    parents.get(e.target)?.push(e.source);
    children.get(e.source)?.push(e.target);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }

  const ready = [...ids].filter((id) => indegree.get(id) === 0).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift() as string;
    order.push(id);
    for (const child of children.get(id) ?? []) {
      const left = (indegree.get(child) ?? 1) - 1;
      indegree.set(child, left);
      if (left === 0) {
        ready.push(child);
        ready.sort();
      }
    }
  }

  const length = new Map<string, number>();
  const prev = new Map<string, string | null>();
  for (const id of order) {
    let best: string | null = null;
    for (const p of parents.get(id) ?? []) {
      if (!length.has(p)) continue;
      const better = best === null || (length.get(p) as number) > (length.get(best) as number) ||
        ((length.get(p) as number) === (length.get(best) as number) && p < best);
      if (better) best = p;
    }
    length.set(id, best === null ? 1 : (length.get(best) as number) + 1);
    prev.set(id, best);
  }

  let end: string | null = null;
  for (const id of order) {
    if (end === null || (length.get(id) as number) > (length.get(end) as number)) end = id;
  }
  const path: string[] = [];
  for (let cur: string | null = end; cur !== null; cur = prev.get(cur) ?? null) path.unshift(cur);
  return path;
}

/** Duyệt `result.groups` theo thứ tự engine (D-84). */
export function lessonGroups(
  result: Pick<ClientStaticEngineResult, "groups" | "nodes" | "edges">,
  overview: RepoOverviewView | "PENDING" | null,
): LessonGroupView[] {
  const ov = overview && overview !== "PENDING" ? overview : null;
  const fromFacts = ov?.facts.main_path_node_ids[0];
  const firstId = fromFacts ?? mainPathOf(result.nodes, result.edges)[0];
  return result.groups.map((g) => ({
    group_id: g.group_id,
    // Tên nhóm AI đặt; chưa có ⇒ nhãn tất định của engine
    name: ov?.ai?.group_names[g.group_id] ?? g.key,
    key_kind: g.key_kind,
    node_ids: g.node_ids,
    recommended: firstId !== undefined && g.node_ids.includes(firstId),
  }));
}

export function groupOfNode(groups: LessonGroupView[], nodeId: string): string | null {
  return groups.find((g) => g.node_ids.includes(nodeId))?.group_id ?? null;
}

/** Mở bài ⇒ mở nhóm của bài đó, giữ nguyên các nhóm đang mở. */
export function openGroupsAfter(open: string[], groups: LessonGroupView[], nodeId: string): string[] {
  const groupId = groupOfNode(groups, nodeId);
  return groupId === null || open.includes(groupId) ? open : [...open, groupId];
}

/** Trạng thái từng node: lấy từ `progress`, node nào thiếu thì suy ra như server (`deriveNodeStates`). */
export function nodeStatesOf(
  nodes: Array<Pick<HybridArchitecturalNode, "id" | "title" | "prerequisites" | "is_capstone">>,
  progress: SessionProgress | null,
): NodeStates {
  const derived = deriveNodeStates(
    nodes.map((n) => ({ node_id: n.id, title: n.title, prerequisites: n.prerequisites, is_capstone: n.is_capstone })),
    [],
  );
  const states: NodeStates = {};
  for (const n of nodes) {
    const known = progress?.nodes[n.id];
    states[n.id] = known
      ? { node_id: known.node_id, status: known.status, has_warning: known.has_warning, analysis_failed: known.analysis_failed }
      : derived[n.id];
  }
  return states;
}

/** Node cha "đã thông": xong, hoặc chưa đạt, hoặc phân tích lỗi nên cho đi tiếp (D-03). */
function passed(s: NodeStateLite | undefined): boolean {
  return !!s && (s.status === "COMPLETED" || s.status === "FAILED" || (s.status === "AVAILABLE" && s.analysis_failed));
}

/** `id` các node cha chưa thông, theo thứ tự `prerequisites`. */
export function blockedBy(node: MapNode, states: NodeStates): string[] {
  return node.prerequisites.filter((id) => id in states && !passed(states[id]));
}

/** `id` các node cha FAILED hoặc phân tích lỗi: lý do hiện ⚠ "Node trước chưa vững". */
export function weakParents(node: MapNode, states: NodeStates): string[] {
  return node.prerequisites.filter((id) => {
    const s = states[id];
    return !!s && (s.status === "FAILED" || (s.status === "AVAILABLE" && s.analysis_failed));
  });
}

/** Bài gốc có cạnh đi ra ⇒ chip "Bắt đầu" (D-85). */
export function startNodeIds(nodes: MapNode[], edges: MapEdge[]): Set<string> {
  const withOutgoing = new Set(edges.map((e) => e.source));
  return new Set(nodes.filter((n) => n.prerequisites.length === 0 && withOutgoing.has(n.id)).map((n) => n.id));
}

/**
 * Bấm vào thẻ làm gì: không `LOCKED` ⇒ mở bài; `LOCKED` ⇒ chỉ báo "Cần xong: …", 0 request.
 * `LOCKED` không bao giờ là ngõ cụt: `hint` luôn có chữ để người học biết đi đâu tiếp.
 */
export function cardAction(
  status: NodeStatus,
  blockedNames: string[],
): { kind: "OPEN" | "BLOCKED"; ariaDisabled: boolean; hint: string | null } {
  if (status !== "LOCKED") return { kind: "OPEN", ariaDisabled: false, hint: null };
  const hint = blockedNames.length > 0 ? `Cần xong: ${blockedNames.join(", ")}` : "Cần xong các bài trước";
  return { kind: "BLOCKED", ariaDisabled: true, hint };
}

/**
 * Bài cần học trước mà bấm được ngay: đi ngược các node cha chưa thông tới node `AVAILABLE`
 * đầu tiên (cha của bài khóa cũng có thể đang khóa). Không có ⇒ `null`.
 */
export function firstOpenableBlocker(
  nodes: MapNode[],
  states: NodeStates,
  nodeId: string,
): string | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>([nodeId]);
  const queue = [nodeId];
  while (queue.length > 0) {
    const node = byId.get(queue.shift() as string);
    if (!node) continue;
    for (const id of blockedBy(node, states)) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (states[id]?.status === "AVAILABLE") return id;
      queue.push(id);
    }
  }
  return null;
}
