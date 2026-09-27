import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { computeRoute, type GraphEdge, type Profile, type RouteRequest, type WorldGraphSnapshot } from "../src/index.ts";

const EPOCH = "00000000-0000-4000-8000-000000000001";
const GRAPH = "seaside-market-v1";
const REQUEST_ID = "00000000-0000-4000-8000-0000000000c1";
const SESSION_ID = "00000000-0000-4000-8000-0000000000d1";
const CONTRACT_FIXTURES = join(
  process.env.CONDUIT_CONTRACTS_DIR ?? fileURLToPath(new URL("../../conduit/contracts/", import.meta.url)),
  "fixtures",
  "valid",
);

const FASTEST: Profile = {
  profileVersion: 1,
  requirements: { avoidStairs: false, maxSlope: null, minWidthM: null },
  preferences: { preferLowCrowd: false, preferLowNoise: false, preferShorterDistance: false },
  context: { carryingBulkyObject: false, carryingHeavyLoad: false },
  presentation: { audioGuidance: true, visualGuidance: true, highContrast: false, language: "en" },
};

const STEP_FREE: Profile = {
  profileVersion: 1,
  requirements: { avoidStairs: true, maxSlope: null, minWidthM: null },
  preferences: { preferLowCrowd: false, preferLowNoise: false, preferShorterDistance: false },
  context: { carryingBulkyObject: false, carryingHeavyLoad: false },
  presentation: { audioGuidance: true, visualGuidance: true, highContrast: false, language: "en" },
};

function cloneProfile(profile: Profile): Profile {
  return structuredClone(profile);
}

function withMaxSlope(profile: Profile, maxSlope: number): Profile {
  const next = cloneProfile(profile);
  next.requirements.maxSlope = maxSlope;
  return next;
}

function request(profile: Profile, origin = "node-start", destination = "node-market"): RouteRequest {
  return {
    schemaVersion: "1.0",
    requestId: REQUEST_ID,
    routeSessionId: SESSION_ID,
    venueId: "seaside-market",
    originNodeId: origin,
    destinationNodeId: destination,
    profile,
  };
}

function seasideEdges(north: "unknown" | "clear" | "blocked"): GraphEdge[] {
  return [
    {
      edgeId: "edge-start-plaza",
      fromNodeId: "node-start",
      toNodeId: "node-plaza",
      distanceM: 10,
      estimatedTimeSec: 10,
      stairs: false,
      slope: 0,
      widthM: 2.0,
      monitored: false,
      obstructionState: "unknown",
      crowdIndex: 0.2,
      noiseIndex: 0.1,
    },
    {
      edgeId: "edge-north-ramp",
      fromNodeId: "node-plaza",
      toNodeId: "node-north",
      distanceM: 12,
      estimatedTimeSec: 14,
      stairs: false,
      slope: 0.05,
      widthM: 1.4,
      monitored: true,
      obstructionState: north,
      crowdIndex: 0.2,
      noiseIndex: 0.1,
    },
    {
      edgeId: "edge-north-market",
      fromNodeId: "node-north",
      toNodeId: "node-market",
      distanceM: 18,
      estimatedTimeSec: 18,
      stairs: false,
      slope: 0,
      widthM: 1.6,
      monitored: false,
      obstructionState: "unknown",
      crowdIndex: 0.2,
      noiseIndex: 0.1,
    },
    {
      edgeId: "edge-east-path",
      fromNodeId: "node-plaza",
      toNodeId: "node-east",
      distanceM: 25,
      estimatedTimeSec: 25,
      stairs: false,
      slope: 0.02,
      widthM: 1.8,
      monitored: false,
      obstructionState: "unknown",
      crowdIndex: 0.2,
      noiseIndex: 0.1,
    },
    {
      edgeId: "edge-east-market",
      fromNodeId: "node-east",
      toNodeId: "node-market",
      distanceM: 35,
      estimatedTimeSec: 35,
      stairs: false,
      slope: 0,
      widthM: 1.8,
      monitored: false,
      obstructionState: "unknown",
      crowdIndex: 0.2,
      noiseIndex: 0.1,
    },
    {
      edgeId: "edge-stair-shortcut",
      fromNodeId: "node-plaza",
      toNodeId: "node-market",
      distanceM: 16,
      estimatedTimeSec: 16,
      stairs: true,
      slope: null,
      widthM: 1.4,
      monitored: false,
      obstructionState: "unknown",
      crowdIndex: 0.2,
      noiseIndex: 0.1,
    },
  ];
}

function snapshot(edges: GraphEdge[], revision: number): WorldGraphSnapshot {
  return {
    worldVersion: {
      worldEpoch: EPOCH,
      graphVersion: GRAPH,
      revision,
    },
    edges,
  };
}

function edge(partial: Partial<GraphEdge> & Pick<GraphEdge, "edgeId" | "fromNodeId" | "toNodeId">): GraphEdge {
  return {
    distanceM: 10,
    estimatedTimeSec: 10,
    stairs: false,
    slope: 0,
    widthM: 2,
    monitored: false,
    obstructionState: "unknown",
    crowdIndex: 0.2,
    noiseIndex: 0.1,
    ...partial,
  };
}

function routeFields(response: ReturnType<typeof computeRoute>) {
  return {
    status: response.status,
    nodeIds: response.nodeIds,
    edgeIds: response.edgeIds,
    distanceM: response.distanceM,
    estimatedTimeSec: response.estimatedTimeSec,
    routingCost: response.routingCost,
    exclusions: response.exclusions,
  };
}

test("unrestricted route uses the 26 m stair shortcut when the ramp is clear", () => {
  const response = computeRoute(request(FASTEST), snapshot(seasideEdges("clear"), 1));
  assert.deepStrictEqual(response, {
    schemaVersion: "1.0",
    requestId: REQUEST_ID,
    routeSessionId: SESSION_ID,
    status: "ok",
    worldVersion: { worldEpoch: EPOCH, graphVersion: GRAPH, revision: 1 },
    profileVersion: 1,
    nodeIds: ["node-start", "node-plaza", "node-market"],
    edgeIds: ["edge-start-plaza", "edge-stair-shortcut"],
    distanceM: 26,
    estimatedTimeSec: 26,
    routingCost: 26,
    explanation: "Unrestricted fixture route uses the stair shortcut. routingCost is not ETA.",
    exclusions: [],
  });
});

test("unrestricted route keeps the stair shortcut when the ramp is blocked", () => {
  const response = computeRoute(request(FASTEST), snapshot(seasideEdges("blocked"), 2));
  assert.deepStrictEqual(routeFields(response), {
    status: "ok",
    nodeIds: ["node-start", "node-plaza", "node-market"],
    edgeIds: ["edge-start-plaza", "edge-stair-shortcut"],
    distanceM: 26,
    estimatedTimeSec: 26,
    routingCost: 26,
    exclusions: [{ edgeId: "edge-north-ramp", reason: "obstruction-blocked" }],
  });
});

test("step-free route uses the 40 m North Ramp when it is clear", () => {
  const response = computeRoute(request(STEP_FREE), snapshot(seasideEdges("clear"), 1));
  assert.deepStrictEqual(response, {
    schemaVersion: "1.0",
    requestId: REQUEST_ID,
    routeSessionId: SESSION_ID,
    status: "ok",
    worldVersion: { worldEpoch: EPOCH, graphVersion: GRAPH, revision: 1 },
    profileVersion: 1,
    nodeIds: ["node-start", "node-plaza", "node-north", "node-market"],
    edgeIds: ["edge-start-plaza", "edge-north-ramp", "edge-north-market"],
    distanceM: 40,
    estimatedTimeSec: 42,
    routingCost: 42,
    explanation: "Step-free fixture route uses the North Ramp while it is clear. routingCost is not ETA.",
    exclusions: [{ edgeId: "edge-stair-shortcut", reason: "stairs" }],
  });
});

test("step-free route uses the 70 m East Path when the North Ramp is blocked", () => {
  const response = computeRoute(request(STEP_FREE), snapshot(seasideEdges("blocked"), 2));
  assert.deepStrictEqual(response, {
    schemaVersion: "1.0",
    requestId: REQUEST_ID,
    routeSessionId: SESSION_ID,
    status: "ok",
    worldVersion: { worldEpoch: EPOCH, graphVersion: GRAPH, revision: 2 },
    profileVersion: 1,
    nodeIds: ["node-start", "node-plaza", "node-east", "node-market"],
    edgeIds: ["edge-start-plaza", "edge-east-path", "edge-east-market"],
    distanceM: 70,
    estimatedTimeSec: 70,
    routingCost: 70,
    explanation: "Step-free fixture route uses the East Path because the North Ramp is blocked. routingCost is not ETA.",
    exclusions: [
      { edgeId: "edge-north-ramp", reason: "obstruction-blocked" },
      { edgeId: "edge-stair-shortcut", reason: "stairs" },
    ],
  });
});

test("a hard slope limit with an unknown stair slope needs verification", () => {
  const response = computeRoute(request(withMaxSlope(FASTEST, 0.01)), snapshot(seasideEdges("clear"), 0));
  assert.deepStrictEqual(response, {
    schemaVersion: "1.0",
    requestId: REQUEST_ID,
    routeSessionId: SESSION_ID,
    status: "needs_verification",
    worldVersion: { worldEpoch: EPOCH, graphVersion: GRAPH, revision: 0 },
    profileVersion: 1,
    nodeIds: [],
    edgeIds: [],
    distanceM: null,
    estimatedTimeSec: null,
    routingCost: null,
    explanation: "Schema example. A hard slope limit leaves only an unknown stair slope, so no route is issued.",
    exclusions: [
      { edgeId: "edge-east-path", reason: "slope" },
      { edgeId: "edge-north-ramp", reason: "slope" },
      { edgeId: "edge-stair-shortcut", reason: "slope-unknown" },
    ],
  });
});

test("step-free plus a hard slope limit is no_route", () => {
  const response = computeRoute(request(withMaxSlope(STEP_FREE, 0.01)), snapshot(seasideEdges("clear"), 0));
  assert.deepStrictEqual(response, {
    schemaVersion: "1.0",
    requestId: REQUEST_ID,
    routeSessionId: SESSION_ID,
    status: "no_route",
    worldVersion: { worldEpoch: EPOCH, graphVersion: GRAPH, revision: 0 },
    profileVersion: 1,
    nodeIds: [],
    edgeIds: [],
    distanceM: null,
    estimatedTimeSec: null,
    routingCost: null,
    explanation: "Schema example. Stairs are forbidden and the remaining paths exceed the slope limit.",
    exclusions: [
      { edgeId: "edge-east-path", reason: "slope" },
      { edgeId: "edge-north-ramp", reason: "slope" },
      { edgeId: "edge-stair-shortcut", reason: "stairs" },
    ],
  });
});

test("expected route cases match the frozen totals and exclusions", () => {
  const cases = [
    {
      id: "unrestricted-north-clear",
      profile: FASTEST,
      north: "clear" as const,
      status: "ok",
      nodeIds: ["node-start", "node-plaza", "node-market"],
      edgeIds: ["edge-start-plaza", "edge-stair-shortcut"],
      distanceM: 26,
      estimatedTimeSec: 26,
      routingCost: 26,
      exclusions: [],
    },
    {
      id: "unrestricted-north-blocked",
      profile: FASTEST,
      north: "blocked" as const,
      status: "ok",
      nodeIds: ["node-start", "node-plaza", "node-market"],
      edgeIds: ["edge-start-plaza", "edge-stair-shortcut"],
      distanceM: 26,
      estimatedTimeSec: 26,
      routingCost: 26,
      exclusions: [{ edgeId: "edge-north-ramp", reason: "obstruction-blocked" }],
    },
    {
      id: "step-free-north-clear",
      profile: STEP_FREE,
      north: "clear" as const,
      status: "ok",
      nodeIds: ["node-start", "node-plaza", "node-north", "node-market"],
      edgeIds: ["edge-start-plaza", "edge-north-ramp", "edge-north-market"],
      distanceM: 40,
      estimatedTimeSec: 42,
      routingCost: 42,
      exclusions: [{ edgeId: "edge-stair-shortcut", reason: "stairs" }],
    },
    {
      id: "step-free-north-blocked",
      profile: STEP_FREE,
      north: "blocked" as const,
      status: "ok",
      nodeIds: ["node-start", "node-plaza", "node-east", "node-market"],
      edgeIds: ["edge-start-plaza", "edge-east-path", "edge-east-market"],
      distanceM: 70,
      estimatedTimeSec: 70,
      routingCost: 70,
      exclusions: [
        { edgeId: "edge-north-ramp", reason: "obstruction-blocked" },
        { edgeId: "edge-stair-shortcut", reason: "stairs" },
      ],
    },
    {
      id: "needs-verification-steep-limit",
      profile: withMaxSlope(FASTEST, 0.01),
      north: "clear" as const,
      status: "needs_verification",
      nodeIds: [],
      edgeIds: [],
      distanceM: null,
      estimatedTimeSec: null,
      routingCost: null,
      exclusions: [
        { edgeId: "edge-east-path", reason: "slope" },
        { edgeId: "edge-north-ramp", reason: "slope" },
        { edgeId: "edge-stair-shortcut", reason: "slope-unknown" },
      ],
    },
    {
      id: "no-route-step-free-steep-limit",
      profile: withMaxSlope(STEP_FREE, 0.01),
      north: "clear" as const,
      status: "no_route",
      nodeIds: [],
      edgeIds: [],
      distanceM: null,
      estimatedTimeSec: null,
      routingCost: null,
      exclusions: [
        { edgeId: "edge-east-path", reason: "slope" },
        { edgeId: "edge-north-ramp", reason: "slope" },
        { edgeId: "edge-stair-shortcut", reason: "stairs" },
      ],
    },
  ];

  for (const item of cases) {
    const response = computeRoute(request(item.profile), snapshot(seasideEdges(item.north), 1));
    assert.deepStrictEqual(routeFields(response), {
      status: item.status,
      nodeIds: item.nodeIds,
      edgeIds: item.edgeIds,
      distanceM: item.distanceM,
      estimatedTimeSec: item.estimatedTimeSec,
      routingCost: item.routingCost,
      exclusions: item.exclusions,
    }, item.id);
  }
});

test("preferShorterDistance does not change routingCost or the chosen edges", () => {
  const flipped = cloneProfile(FASTEST);
  flipped.preferences.preferShorterDistance = true;
  const base = computeRoute(request(FASTEST), snapshot(seasideEdges("clear"), 1));
  const next = computeRoute(request(flipped), snapshot(seasideEdges("clear"), 1));
  assert.deepStrictEqual(next.edgeIds, base.edgeIds);
  assert.equal(next.routingCost, base.routingCost);
  assert.equal(next.distanceM, 26);
});

test("uniform crowd and noise weights do not reorder the step-free route", () => {
  const weighted = cloneProfile(STEP_FREE);
  weighted.preferences.preferLowCrowd = true;
  weighted.preferences.preferLowNoise = true;
  const response = computeRoute(request(weighted), snapshot(seasideEdges("clear"), 1));
  assert.deepStrictEqual(response.edgeIds, ["edge-start-plaza", "edge-north-ramp", "edge-north-market"]);
  assert.equal(response.distanceM, 40);
  assert.equal(response.estimatedTimeSec, 42);
  assert.equal(response.routingCost, 49.35);
  assert.notEqual(response.routingCost, response.estimatedTimeSec);
});

test("crowd weight alone uses 0.75 and leaves distance and time unchanged", () => {
  const carrying = cloneProfile(STEP_FREE);
  carrying.preferences.preferLowCrowd = true;
  carrying.context.carryingBulkyObject = true;
  const response = computeRoute(request(carrying), snapshot(seasideEdges("clear"), 1));
  assert.deepStrictEqual(response.edgeIds, ["edge-start-plaza", "edge-north-ramp", "edge-north-market"]);
  assert.equal(response.distanceM, 40);
  assert.equal(response.estimatedTimeSec, 42);
  assert.equal(response.routingCost, 48.3);
});

test("edge order in the snapshot does not change the route", () => {
  const edges = seasideEdges("clear").reverse();
  const response = computeRoute(request(FASTEST), snapshot(edges, 1));
  assert.deepStrictEqual(response.edgeIds, ["edge-start-plaza", "edge-stair-shortcut"]);
  assert.equal(response.distanceM, 26);
});

test("monitored unknown is excluded and unmonitored unknown stays on an ok route", () => {
  const initial = computeRoute(request(FASTEST), snapshot(seasideEdges("unknown"), 0));
  assert.equal(initial.status, "ok");
  assert.deepStrictEqual(initial.edgeIds, ["edge-start-plaza", "edge-stair-shortcut"]);
  assert.deepStrictEqual(initial.exclusions, [{ edgeId: "edge-north-ramp", reason: "monitored-unknown" }]);

  const stepFree = computeRoute(request(STEP_FREE), snapshot(seasideEdges("unknown"), 0));
  assert.equal(stepFree.status, "ok");
  assert.deepStrictEqual(stepFree.edgeIds, ["edge-start-plaza", "edge-east-path", "edge-east-market"]);
  assert.equal(stepFree.distanceM, 70);
  assert.deepStrictEqual(stepFree.exclusions, [
    { edgeId: "edge-north-ramp", reason: "monitored-unknown" },
    { edgeId: "edge-stair-shortcut", reason: "stairs" },
  ]);
});

test("a monitored unknown edge with no other path needs verification", () => {
  const response = computeRoute(
    request(FASTEST, "node-a", "node-b"),
    snapshot(
      [
        edge({
          edgeId: "edge-only",
          fromNodeId: "node-a",
          toNodeId: "node-b",
          monitored: true,
          obstructionState: "unknown",
        }),
      ],
      3,
    ),
  );
  assert.equal(response.status, "needs_verification");
  assert.deepStrictEqual(response.nodeIds, []);
  assert.deepStrictEqual(response.edgeIds, []);
  assert.equal(response.distanceM, null);
  assert.equal(response.estimatedTimeSec, null);
  assert.equal(response.routingCost, null);
  assert.deepStrictEqual(response.exclusions, [{ edgeId: "edge-only", reason: "monitored-unknown" }]);
  assert.equal(response.worldVersion.revision, 3);
});

test("unknown slope or width required by the profile does not pass", () => {
  const slopeProfile = withMaxSlope(FASTEST, 0.05);
  const slope = computeRoute(
    request(slopeProfile, "node-a", "node-b"),
    snapshot(
      [
        edge({
          edgeId: "edge-slope",
          fromNodeId: "node-a",
          toNodeId: "node-b",
          slope: null,
        }),
      ],
      0,
    ),
  );
  assert.equal(slope.status, "needs_verification");
  assert.deepStrictEqual(slope.exclusions, [{ edgeId: "edge-slope", reason: "slope-unknown" }]);

  const widthProfile = cloneProfile(FASTEST);
  widthProfile.requirements.minWidthM = 1.2;
  const width = computeRoute(
    request(widthProfile, "node-a", "node-b"),
    snapshot(
      [
        edge({
          edgeId: "edge-width",
          fromNodeId: "node-a",
          toNodeId: "node-b",
          widthM: null,
        }),
      ],
      0,
    ),
  );
  assert.equal(width.status, "needs_verification");
  assert.deepStrictEqual(width.exclusions, [{ edgeId: "edge-width", reason: "width-unknown" }]);
});

test("known slope and width limits hard-reject and a blocked stair reports obstruction first", () => {
  const narrow = cloneProfile(FASTEST);
  narrow.requirements.minWidthM = 1.5;
  const width = computeRoute(request(narrow), snapshot(seasideEdges("clear"), 1));
  assert.equal(width.status, "ok");
  assert.deepStrictEqual(width.edgeIds, ["edge-start-plaza", "edge-east-path", "edge-east-market"]);
  assert.deepStrictEqual(width.exclusions, [
    { edgeId: "edge-north-ramp", reason: "width" },
    { edgeId: "edge-stair-shortcut", reason: "width" },
  ]);

  const blockedStairs = cloneProfile(STEP_FREE);
  const blocked = computeRoute(
    request(blockedStairs, "node-a", "node-b"),
    snapshot(
      [
        edge({
          edgeId: "edge-steps",
          fromNodeId: "node-a",
          toNodeId: "node-b",
          stairs: true,
          obstructionState: "blocked",
        }),
      ],
      0,
    ),
  );
  assert.equal(blocked.status, "no_route");
  assert.deepStrictEqual(blocked.exclusions, [{ edgeId: "edge-steps", reason: "obstruction-blocked" }]);
});

test("equal slope and equal width still pass", () => {
  const profile = cloneProfile(FASTEST);
  profile.requirements.maxSlope = 0.05;
  profile.requirements.minWidthM = 1.4;
  const response = computeRoute(
    request(profile, "node-a", "node-b"),
    snapshot(
      [
        edge({
          edgeId: "edge-fit",
          fromNodeId: "node-a",
          toNodeId: "node-b",
          slope: 0.05,
          widthM: 1.4,
          obstructionState: "clear",
          distanceM: 4,
          estimatedTimeSec: 4,
        }),
      ],
      0,
    ),
  );
  assert.equal(response.status, "ok");
  assert.deepStrictEqual(response.edgeIds, ["edge-fit"]);
  assert.equal(response.routingCost, 4);
});

test("tie-break uses routingCost, then time, then distance, then edge ids", () => {
  const byCost = computeRoute(
    request(FASTEST, "node-a", "node-b"),
    snapshot(
      [
        edge({ edgeId: "edge-slow", fromNodeId: "node-a", toNodeId: "node-b", distanceM: 1, estimatedTimeSec: 9 }),
        edge({ edgeId: "edge-fast", fromNodeId: "node-a", toNodeId: "node-b", distanceM: 30, estimatedTimeSec: 4 }),
      ],
      0,
    ),
  );
  assert.deepStrictEqual(byCost.edgeIds, ["edge-fast"]);

  const timeProfile = cloneProfile(FASTEST);
  timeProfile.preferences.preferLowCrowd = true;
  const byTime = computeRoute(
    request(timeProfile, "node-a", "node-b"),
    snapshot(
      [
        edge({
          edgeId: "edge-longer-time",
          fromNodeId: "node-a",
          toNodeId: "node-b",
          distanceM: 1,
          estimatedTimeSec: 10,
          crowdIndex: 0,
          noiseIndex: 0,
        }),
        edge({
          edgeId: "edge-shorter-time",
          fromNodeId: "node-a",
          toNodeId: "node-b",
          distanceM: 100,
          estimatedTimeSec: 8,
          crowdIndex: 1 / 3,
          noiseIndex: 0,
        }),
      ],
      0,
    ),
  );
  assert.equal(byTime.routingCost, 10);
  assert.deepStrictEqual(byTime.edgeIds, ["edge-shorter-time"]);
  assert.equal(byTime.estimatedTimeSec, 8);

  const byDistance = computeRoute(
    request(FASTEST, "node-a", "node-b"),
    snapshot(
      [
        edge({ edgeId: "edge-far", fromNodeId: "node-a", toNodeId: "node-b", distanceM: 9, estimatedTimeSec: 5 }),
        edge({ edgeId: "edge-near", fromNodeId: "node-a", toNodeId: "node-b", distanceM: 3, estimatedTimeSec: 5 }),
      ],
      0,
    ),
  );
  assert.deepStrictEqual(byDistance.edgeIds, ["edge-near"]);

  const byId = computeRoute(
    request(FASTEST, "node-a", "node-b"),
    snapshot(
      [
        edge({ edgeId: "edge-b", fromNodeId: "node-a", toNodeId: "node-b", distanceM: 5, estimatedTimeSec: 5 }),
        edge({ edgeId: "edge-a", fromNodeId: "node-a", toNodeId: "node-b", distanceM: 5, estimatedTimeSec: 5 }),
      ],
      0,
    ),
  );
  assert.deepStrictEqual(byId.edgeIds, ["edge-a"]);

  const bySequence = computeRoute(
    request(FASTEST, "node-a", "node-c"),
    snapshot(
      [
        edge({ edgeId: "edge-m", fromNodeId: "node-a", toNodeId: "node-b1", distanceM: 2, estimatedTimeSec: 2 }),
        edge({ edgeId: "edge-z", fromNodeId: "node-b1", toNodeId: "node-c", distanceM: 2, estimatedTimeSec: 2 }),
        edge({ edgeId: "edge-m", fromNodeId: "node-a", toNodeId: "node-b2", distanceM: 2, estimatedTimeSec: 2 }),
        edge({ edgeId: "edge-a", fromNodeId: "node-b2", toNodeId: "node-c", distanceM: 2, estimatedTimeSec: 2 }),
      ],
      0,
    ),
  );
  assert.deepStrictEqual(bySequence.edgeIds, ["edge-m", "edge-a"]);
});

test("computeRoute does not mutate the request or the snapshot", () => {
  const routeRequest = request(FASTEST);
  const world = snapshot(seasideEdges("blocked"), 2);
  const frozenRequest = structuredClone(routeRequest);
  const frozenWorld = structuredClone(world);
  deepFreeze(routeRequest);
  deepFreeze(world);
  const response = computeRoute(routeRequest, world);
  assert.equal(response.status, "ok");
  assert.deepStrictEqual(routeRequest, frozenRequest);
  assert.deepStrictEqual(world, frozenWorld);
});

test("on-disk route fixtures match computeRoute when the freeze checkout is present", () => {
  if (!existsSync(CONTRACT_FIXTURES)) {
    return;
  }
  const expected = JSON.parse(readFileSync(`${CONTRACT_FIXTURES}/expected-routes.json`, "utf8"));
  const presets = JSON.parse(readFileSync(`${CONTRACT_FIXTURES}/presets.json`, "utf8")).presets;
  for (const item of expected.cases) {
    const profile = structuredClone(presets[item.preset]);
    if ("maxSlope" in item) profile.requirements.maxSlope = item.maxSlope;
    const edges = seasideEdges(item.obstruction["edge-north-ramp"]);
    const response = computeRoute(request(profile), snapshot(edges, 1));
    assert.equal(response.status, item.status, item.id);
    assert.deepStrictEqual(response.nodeIds, item.nodeIds, item.id);
    assert.deepStrictEqual(response.edgeIds, item.edgeIds, item.id);
    assert.equal(response.distanceM, item.distanceM, item.id);
    assert.equal(response.estimatedTimeSec, item.estimatedTimeSec, item.id);
    assert.equal(response.routingCost, item.routingCost, item.id);
    assert.deepStrictEqual(response.exclusions, item.exclusions, item.id);
  }

  const documents = [
    {
      file: "route-response-unrestricted.json",
      profile: FASTEST,
      north: "clear" as const,
      revision: 1,
    },
    {
      file: "route-response-step-free-north.json",
      profile: STEP_FREE,
      north: "clear" as const,
      revision: 1,
    },
    {
      file: "route-response-step-free-east.json",
      profile: STEP_FREE,
      north: "blocked" as const,
      revision: 2,
    },
    {
      file: "route-response-needs-verification.json",
      profile: withMaxSlope(FASTEST, 0.01),
      north: "clear" as const,
      revision: 0,
    },
    {
      file: "route-response-no-route.json",
      profile: withMaxSlope(STEP_FREE, 0.01),
      north: "clear" as const,
      revision: 0,
    },
  ];
  for (const document of documents) {
    const fixture = JSON.parse(readFileSync(`${CONTRACT_FIXTURES}/${document.file}`, "utf8"));
    const response = computeRoute(
      request(document.profile),
      snapshot(seasideEdges(document.north), document.revision),
    );
    assert.deepStrictEqual(response, fixture, document.file);
  }
});

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}
