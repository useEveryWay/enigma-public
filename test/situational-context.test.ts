import assert from "node:assert/strict";
import test from "node:test";

import {
  BULKY_MIN_WIDTH_M,
  computeRoute,
  HEAVY_RAMP_GRADE,
  type GraphEdge,
  type Profile,
  type RouteRequest,
  type WorldGraphSnapshot,
} from "../src/index.ts";

const EPOCH = "00000000-0000-4000-8000-000000000001";
const GRAPH = "situational-fixture-v1";
const REQUEST_ID = "00000000-0000-4000-8000-0000000000c1";
const SESSION_ID = "00000000-0000-4000-8000-0000000000d2";

const BASE: Profile = {
  profileVersion: 1,
  requirements: { avoidStairs: false, maxSlope: null, minWidthM: null },
  preferences: { preferLowCrowd: false, preferLowNoise: false, preferShorterDistance: false },
  context: { carryingBulkyObject: false, carryingHeavyLoad: false },
  presentation: { audioGuidance: true, visualGuidance: true, highContrast: false, language: "en" },
};

function withContext(profile: Profile, bulky: boolean, heavy: boolean): Profile {
  const next = structuredClone(profile);
  next.context.carryingBulkyObject = bulky;
  next.context.carryingHeavyLoad = heavy;
  return next;
}

function request(profile: Profile, origin = "node-a", destination = "node-d"): RouteRequest {
  return {
    schemaVersion: "1.0",
    requestId: REQUEST_ID,
    routeSessionId: SESSION_ID,
    venueId: "situational-fixture",
    originNodeId: origin,
    destinationNodeId: destination,
    profile,
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

function snapshot(edges: GraphEdge[]): WorldGraphSnapshot {
  return {
    worldVersion: { worldEpoch: EPOCH, graphVersion: GRAPH, revision: 1 },
    edges,
  };
}

function narrowGraph(): GraphEdge[] {
  return [
    edge({ edgeId: "edge-narrow", fromNodeId: "node-a", toNodeId: "node-b", distanceM: 10, estimatedTimeSec: 10, widthM: 0.6 }),
    edge({ edgeId: "edge-bd", fromNodeId: "node-b", toNodeId: "node-d", distanceM: 10, estimatedTimeSec: 10 }),
    edge({ edgeId: "edge-ac", fromNodeId: "node-a", toNodeId: "node-c", distanceM: 15, estimatedTimeSec: 15 }),
    edge({ edgeId: "edge-cd", fromNodeId: "node-c", toNodeId: "node-d", distanceM: 15, estimatedTimeSec: 15 }),
  ];
}

function stairsGraph(): GraphEdge[] {
  return [
    edge({ edgeId: "edge-stairs", fromNodeId: "node-a", toNodeId: "node-d", stairs: true, slope: null }),
    edge({ edgeId: "edge-ac", fromNodeId: "node-a", toNodeId: "node-c", distanceM: 8, estimatedTimeSec: 8, slope: 0.02 }),
    edge({ edgeId: "edge-cd", fromNodeId: "node-c", toNodeId: "node-d", distanceM: 7, estimatedTimeSec: 7 }),
  ];
}

function steepGraph(): GraphEdge[] {
  return [
    edge({ edgeId: "edge-steep", fromNodeId: "node-a", toNodeId: "node-d", slope: 0.08 }),
    edge({ edgeId: "edge-ac", fromNodeId: "node-a", toNodeId: "node-c", distanceM: 8, estimatedTimeSec: 8 }),
    edge({ edgeId: "edge-cd", fromNodeId: "node-c", toNodeId: "node-d", distanceM: 6, estimatedTimeSec: 6 }),
  ];
}

test("situational constants cite the ADA boundaries", () => {
  assert.equal(BULKY_MIN_WIDTH_M, 0.915);
  assert.equal(HEAVY_RAMP_GRADE, 0.05);
});

test("carryingBulkyObject reroutes around a narrow edge and fails closed on unknown width", () => {
  const world = snapshot(narrowGraph());
  const base = computeRoute(request(BASE), world);
  assert.deepEqual(base.edgeIds, ["edge-narrow", "edge-bd"]);
  assert.equal(base.distanceM, 20);
  assert.equal(base.estimatedTimeSec, 20);

  const bulky = computeRoute(request(withContext(BASE, true, false)), world);
  assert.equal(bulky.status, "ok");
  assert.deepEqual(bulky.edgeIds, ["edge-ac", "edge-cd"]);
  assert.equal(bulky.distanceM, 30);
  assert.equal(bulky.estimatedTimeSec, 30);
  assert.deepEqual(bulky.exclusions, [{ edgeId: "edge-narrow", reason: "width" }]);

  const loose = structuredClone(BASE);
  loose.requirements.minWidthM = 0.5;
  assert.deepEqual(computeRoute(request(loose), world).edgeIds, ["edge-narrow", "edge-bd"]);
  assert.deepEqual(computeRoute(request(withContext(loose, true, false)), world).edgeIds, ["edge-ac", "edge-cd"]);

  const unknown = computeRoute(
    request(withContext(BASE, true, false)),
    snapshot([edge({ edgeId: "edge-only", fromNodeId: "node-a", toNodeId: "node-d", widthM: null })]),
  );
  assert.equal(unknown.status, "needs_verification");
  assert.deepEqual(unknown.edgeIds, []);
  assert.deepEqual(unknown.exclusions, [{ edgeId: "edge-only", reason: "width-unknown" }]);
});

test("carryingHeavyLoad adds soft cost and does not change exclusions", () => {
  const stairs = snapshot(stairsGraph());
  const baseStairs = computeRoute(request(BASE), stairs);
  assert.deepEqual(baseStairs.edgeIds, ["edge-stairs"]);
  assert.equal(baseStairs.routingCost, 10);

  const heavyStairs = computeRoute(request(withContext(BASE, false, true)), stairs);
  assert.deepEqual(heavyStairs.edgeIds, ["edge-ac", "edge-cd"]);
  assert.equal(heavyStairs.routingCost, 15);
  assert.equal(heavyStairs.estimatedTimeSec, 15);
  assert.deepEqual(heavyStairs.exclusions, []);

  const steep = snapshot(steepGraph());
  assert.deepEqual(computeRoute(request(BASE), steep).edgeIds, ["edge-steep"]);
  const heavySteep = computeRoute(request(withContext(BASE, false, true)), steep);
  assert.deepEqual(heavySteep.edgeIds, ["edge-ac", "edge-cd"]);
  assert.equal(heavySteep.routingCost, 14);
  assert.deepEqual(heavySteep.exclusions, []);

  const stepFree = structuredClone(BASE);
  stepFree.requirements.avoidStairs = true;
  const stillExcluded = computeRoute(request(withContext(stepFree, false, true)), stairs);
  assert.deepEqual(stillExcluded.edgeIds, ["edge-ac", "edge-cd"]);
  assert.deepEqual(stillExcluded.exclusions, [{ edgeId: "edge-stairs", reason: "stairs" }]);
});

test("both context flags false match the baseline route", () => {
  for (const edges of [narrowGraph(), stairsGraph(), steepGraph()]) {
    const world = snapshot(edges);
    assert.deepEqual(
      computeRoute(request(withContext(BASE, false, false)), world),
      computeRoute(request(BASE), world),
    );
  }
});
