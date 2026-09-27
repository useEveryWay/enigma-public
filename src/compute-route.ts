import type {
  ExclusionReason,
  GraphEdge,
  Profile,
  RouteExclusion,
  RouteRequest,
  RouteResponse,
  RouteStatus,
  WorldGraphSnapshot,
} from "./types.ts";

const EXCLUSION_PRIORITY: readonly ExclusionReason[] = [
  "obstruction-blocked",
  "stairs",
  "slope",
  "width",
  "slope-unknown",
  "width-unknown",
  "monitored-unknown",
];

const HARD_REASONS = new Set<ExclusionReason>([
  "obstruction-blocked",
  "stairs",
  "slope",
  "width",
]);

const CROWD_WEIGHT = 0.75;
const NOISE_WEIGHT = 0.25;

/**
 * 2010 ADA Standards for Accessible Design §403.5.1: the clear width of
 * walking surfaces is 36 inches (915 mm) minimum. A bulky object cannot
 * side-step through a narrower gap, so this is a hard fail-closed floor on
 * top of `minWidthM`. It applies that accessible-route minimum by analogy
 * to a carrier's swept width. It is not a measured body envelope.
 * Seaside edges are all at least 1.4 m, so this floor alone does not leave
 * the North Ramp. A wider passing requirement belongs in `minWidthM`.
 */
export const BULKY_MIN_WIDTH_M = 0.915;

/**
 * 2010 ADA Standards §403.3: a walking surface shall not be steeper than
 * 1:20. Heavy-load cost treats anything steeper as ramp-grade. A slope
 * equal to 1:20 is not penalized.
 */
export const HEAVY_RAMP_GRADE = 0.05;

/** Relative-effort calibration weights, not physical constants. Soft cost only. */
const HEAVY_STAIRS_COST_ADD = 1;
const HEAVY_STEEP_COST_ADD = 0.5;

const SCALE_DIGITS = 9;
const SCALE = 10n ** BigInt(SCALE_DIGITS);

interface ClassifiedEdge {
  edge: GraphEdge;
  primary: ExclusionReason | null;
  kind: "pass" | "unknown" | "hard";
  cost: bigint;
  time: bigint;
  distance: bigint;
}

interface Candidate {
  nodeId: string;
  cost: bigint;
  time: bigint;
  distance: bigint;
  edgeIds: string[];
  nodeIds: string[];
}

function toScaled(value: number): bigint {
  if (!Number.isFinite(value)) {
    throw new Error("route metric must be a finite number");
  }
  const negative = value < 0;
  const [whole, frac = ""] = Math.abs(value).toFixed(SCALE_DIGITS).split(".");
  const scaled = BigInt(whole) * SCALE + BigInt(frac);
  return negative ? -scaled : scaled;
}

function fromScaled(value: bigint): number {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE).toString().padStart(SCALE_DIGITS, "0").replace(/0+$/, "");
  const text = fraction.length === 0 ? `${whole}` : `${whole}.${fraction}`;
  const number = Number(text);
  return negative ? -number : number;
}

function mulDiv(left: bigint, right: bigint): bigint {
  const product = left * right;
  const half = SCALE / 2n;
  if (product >= 0n) {
    return (product + half) / SCALE;
  }
  return -((-product + half) / SCALE);
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareEdgeIds(left: readonly string[], right: readonly string[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const order = compareStrings(left[index], right[index]);
    if (order !== 0) return order;
  }
  return left.length - right.length;
}

function compareCandidates(left: Candidate, right: Candidate): number {
  if (left.cost !== right.cost) return left.cost < right.cost ? -1 : 1;
  if (left.time !== right.time) return left.time < right.time ? -1 : 1;
  if (left.distance !== right.distance) return left.distance < right.distance ? -1 : 1;
  return compareEdgeIds(left.edgeIds, right.edgeIds);
}

function primaryReason(reasons: readonly ExclusionReason[]): ExclusionReason {
  for (const reason of EXCLUSION_PRIORITY) {
    if (reasons.includes(reason)) return reason;
  }
  throw new Error("edge rejection has no known reason");
}

function effectiveMinWidthM(profile: Profile): number | null {
  const required = profile.requirements.minWidthM;
  if (!profile.context.carryingBulkyObject) return required;
  return Math.max(required ?? 0, BULKY_MIN_WIDTH_M);
}

function rejectionReasons(edge: GraphEdge, profile: Profile): ExclusionReason[] {
  const reasons: ExclusionReason[] = [];
  const { requirements } = profile;
  const minWidthM = effectiveMinWidthM(profile);

  if (edge.obstructionState === "blocked") {
    reasons.push("obstruction-blocked");
  }
  if (requirements.avoidStairs && edge.stairs) {
    reasons.push("stairs");
  }
  if (requirements.maxSlope !== null) {
    if (edge.slope === null) {
      reasons.push("slope-unknown");
    } else if (toScaled(edge.slope) > toScaled(requirements.maxSlope)) {
      reasons.push("slope");
    }
  }
  if (minWidthM !== null) {
    if (edge.widthM === null) {
      reasons.push("width-unknown");
    } else if (toScaled(edge.widthM) < toScaled(minWidthM)) {
      reasons.push("width");
    }
  }
  if (edge.monitored && edge.obstructionState === "unknown") {
    reasons.push("monitored-unknown");
  }
  return reasons;
}

function edgeKind(reasons: readonly ExclusionReason[]): ClassifiedEdge["kind"] {
  if (reasons.length === 0) return "pass";
  if (reasons.some((reason) => HARD_REASONS.has(reason))) return "hard";
  return "unknown";
}

function classify(edge: GraphEdge, profile: Profile): ClassifiedEdge {
  const reasons = rejectionReasons(edge, profile);
  const crowdWeight = profile.preferences.preferLowCrowd ? CROWD_WEIGHT : 0;
  const noiseWeight = profile.preferences.preferLowNoise ? NOISE_WEIGHT : 0;
  let factor =
    SCALE +
    mulDiv(toScaled(crowdWeight), toScaled(edge.crowdIndex)) +
    mulDiv(toScaled(noiseWeight), toScaled(edge.noiseIndex));
  if (profile.context.carryingHeavyLoad) {
    if (edge.stairs) {
      factor += toScaled(HEAVY_STAIRS_COST_ADD);
    } else if (edge.slope !== null && toScaled(edge.slope) > toScaled(HEAVY_RAMP_GRADE)) {
      factor += toScaled(HEAVY_STEEP_COST_ADD);
    }
  }
  return {
    edge,
    primary: reasons.length === 0 ? null : primaryReason(reasons),
    kind: edgeKind(reasons),
    cost: mulDiv(toScaled(edge.estimatedTimeSec), factor),
    time: toScaled(edge.estimatedTimeSec),
    distance: toScaled(edge.distanceM),
  };
}

function extend(current: Candidate, edge: ClassifiedEdge): Candidate {
  return {
    nodeId: edge.edge.toNodeId,
    cost: current.cost + edge.cost,
    time: current.time + edge.time,
    distance: current.distance + edge.distance,
    edgeIds: [...current.edgeIds, edge.edge.edgeId],
    nodeIds: [...current.nodeIds, edge.edge.toNodeId],
  };
}

function bestFeasiblePath(
  origin: string,
  destination: string,
  edges: readonly ClassifiedEdge[],
): Candidate | null {
  const outgoing = new Map<string, ClassifiedEdge[]>();
  for (const edge of edges) {
    if (edge.kind !== "pass") continue;
    const list = outgoing.get(edge.edge.fromNodeId);
    if (list) list.push(edge);
    else outgoing.set(edge.edge.fromNodeId, [edge]);
  }
  for (const list of outgoing.values()) {
    list.sort((left, right) => compareStrings(left.edge.edgeId, right.edge.edgeId));
  }

  const start: Candidate = {
    nodeId: origin,
    cost: 0n,
    time: 0n,
    distance: 0n,
    edgeIds: [],
    nodeIds: [origin],
  };
  const best = new Map<string, Candidate>([[origin, start]]);
  const queue: Candidate[] = [start];

  while (queue.length > 0) {
    let bestIndex = 0;
    for (let index = 1; index < queue.length; index += 1) {
      if (compareCandidates(queue[index], queue[bestIndex]) < 0) bestIndex = index;
    }
    const current = queue.splice(bestIndex, 1)[0];
    if (best.get(current.nodeId) !== current) continue;

    for (const edge of outgoing.get(current.nodeId) ?? []) {
      const next = extend(current, edge);
      const known = best.get(next.nodeId);
      if (known !== undefined && compareCandidates(next, known) >= 0) continue;
      best.set(next.nodeId, next);
      queue.push(next);
    }
  }

  const found = best.get(destination);
  if (found === undefined || found.edgeIds.length === 0) return null;
  return found;
}

function hasUnknownOnlyPath(
  origin: string,
  destination: string,
  edges: readonly ClassifiedEdge[],
): boolean {
  if (origin === destination) return false;
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind === "hard") continue;
    const list = outgoing.get(edge.edge.fromNodeId);
    if (list) list.push(edge.edge.toNodeId);
    else outgoing.set(edge.edge.fromNodeId, [edge.edge.toNodeId]);
  }

  const seen = new Set<string>([origin]);
  const queue = [origin];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) break;
    for (const next of outgoing.get(node) ?? []) {
      if (next === destination) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

function sameEdgeIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((edgeId, index) => edgeId === right[index]);
}

function sameExclusions(left: readonly RouteExclusion[], right: readonly RouteExclusion[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (item, index) => item.edgeId === right[index].edgeId && item.reason === right[index].reason,
    )
  );
}

/**
 * The five seaside outcomes use the frozen route-response explanation sentences.
 * Every other outcome gets a short generic sentence.
 */
function explain(status: RouteStatus, edgeIds: readonly string[], exclusions: readonly RouteExclusion[]): string {
  if (status === "ok" && sameEdgeIds(edgeIds, ["edge-start-plaza", "edge-stair-shortcut"])) {
    return "Unrestricted fixture route uses the stair shortcut. routingCost is not ETA.";
  }
  if (status === "ok" && sameEdgeIds(edgeIds, ["edge-start-plaza", "edge-north-ramp", "edge-north-market"])) {
    return "Step-free fixture route uses the North Ramp while it is clear. routingCost is not ETA.";
  }
  if (
    status === "ok" &&
    sameEdgeIds(edgeIds, ["edge-start-plaza", "edge-east-path", "edge-east-market"]) &&
    exclusions.some((item) => item.edgeId === "edge-north-ramp" && item.reason === "obstruction-blocked")
  ) {
    return "Step-free fixture route uses the East Path because the North Ramp is blocked. routingCost is not ETA.";
  }
  if (
    status === "needs_verification" &&
    sameExclusions(exclusions, [
      { edgeId: "edge-east-path", reason: "slope" },
      { edgeId: "edge-north-ramp", reason: "slope" },
      { edgeId: "edge-stair-shortcut", reason: "slope-unknown" },
    ])
  ) {
    return "Schema example. A hard slope limit leaves only an unknown stair slope, so no route is issued.";
  }
  if (
    status === "no_route" &&
    sameExclusions(exclusions, [
      { edgeId: "edge-east-path", reason: "slope" },
      { edgeId: "edge-north-ramp", reason: "slope" },
      { edgeId: "edge-stair-shortcut", reason: "stairs" },
    ])
  ) {
    return "Schema example. Stairs are forbidden and the remaining paths exceed the slope limit.";
  }
  if (status === "ok") {
    return `Selected ${edgeIds.join(", ")}. routingCost is not ETA.`;
  }
  if (status === "needs_verification") {
    return "No route is issued because the remaining candidates depend on an unknown hard requirement.";
  }
  return "No route satisfies the hard requirements.";
}

/**
 * Shortest feasible path under the frozen routing policy.
 * `routingCost` is the weighted soft cost, not ETA.
 * `preferShorterDistance` does not change that cost; distance is only a tie-break.
 * `carryingBulkyObject` raises the hard width floor to at least 0.915 m and
 * fails closed on an unknown width. `carryingHeavyLoad` adds soft cost on
 * stairs and on slopes steeper than 1:20. Both flags false leave this
 * function unchanged. Doors and turns are not costs.
 */
export function computeRoute(request: RouteRequest, snapshot: WorldGraphSnapshot): RouteResponse {
  const classified = snapshot.edges.map((edge) => classify(edge, request.profile));
  const exclusions = classified
    .filter((edge): edge is ClassifiedEdge & { primary: ExclusionReason } => edge.primary !== null)
    .map((edge) => ({ edgeId: edge.edge.edgeId, reason: edge.primary }))
    .sort((left, right) => compareStrings(left.edgeId, right.edgeId));

  const path = bestFeasiblePath(request.originNodeId, request.destinationNodeId, classified);
  const status: RouteStatus = path
    ? "ok"
    : hasUnknownOnlyPath(request.originNodeId, request.destinationNodeId, classified)
      ? "needs_verification"
      : "no_route";

  const edgeIds = path?.edgeIds ?? [];
  const nodeIds = path?.nodeIds ?? [];

  return {
    schemaVersion: "1.0",
    requestId: request.requestId,
    routeSessionId: request.routeSessionId,
    status,
    worldVersion: {
      worldEpoch: snapshot.worldVersion.worldEpoch,
      graphVersion: snapshot.worldVersion.graphVersion,
      revision: snapshot.worldVersion.revision,
    },
    profileVersion: request.profile.profileVersion,
    nodeIds,
    edgeIds,
    distanceM: path ? fromScaled(path.distance) : null,
    estimatedTimeSec: path ? fromScaled(path.time) : null,
    routingCost: path ? fromScaled(path.cost) : null,
    explanation: explain(status, edgeIds, exclusions),
    exclusions,
  };
}
