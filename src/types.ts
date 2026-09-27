export type ObstructionState = "unknown" | "clear" | "blocked";

export type RouteStatus = "ok" | "needs_verification" | "no_route";

export type ExclusionReason =
  | "obstruction-blocked"
  | "stairs"
  | "slope"
  | "width"
  | "slope-unknown"
  | "width-unknown"
  | "monitored-unknown";

export interface Profile {
  profileVersion: 1;
  requirements: {
    avoidStairs: boolean;
    maxSlope: number | null;
    minWidthM: number | null;
  };
  preferences: {
    preferLowCrowd: boolean;
    preferLowNoise: boolean;
    preferShorterDistance: boolean;
  };
  context: {
    carryingBulkyObject: boolean;
    carryingHeavyLoad: boolean;
  };
  presentation: {
    audioGuidance: boolean;
    visualGuidance: boolean;
    highContrast: boolean;
    language: string;
  };
}

export interface RouteRequest {
  schemaVersion: "1.0";
  requestId: string;
  routeSessionId: string;
  venueId: string;
  originNodeId: string;
  destinationNodeId: string;
  profile: Profile;
}

/** One directed edge with graph metrics and the live world facts for that edge. */
export interface GraphEdge {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  distanceM: number;
  estimatedTimeSec: number;
  stairs: boolean;
  slope: number | null;
  widthM: number | null;
  monitored: boolean;
  obstructionState: ObstructionState;
  crowdIndex: number;
  noiseIndex: number;
}

/**
 * Graph metrics plus the world snapshot the caller already assembled.
 * Obstruction, crowd, and noise come from this object; the router does not
 * invent them.
 */
export interface WorldGraphSnapshot {
  worldVersion: {
    worldEpoch: string;
    graphVersion: string;
    revision: number;
  };
  edges: GraphEdge[];
}

export interface RouteExclusion {
  edgeId: string;
  reason: ExclusionReason;
}

export interface RouteResponse {
  schemaVersion: "1.0";
  requestId: string;
  routeSessionId: string;
  status: RouteStatus;
  worldVersion: WorldGraphSnapshot["worldVersion"];
  profileVersion: 1;
  nodeIds: string[];
  edgeIds: string[];
  distanceM: number | null;
  estimatedTimeSec: number | null;
  routingCost: number | null;
  explanation: string;
  exclusions: RouteExclusion[];
}
