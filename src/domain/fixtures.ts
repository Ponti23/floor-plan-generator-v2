import {
  CANONICAL_OFFSET_EAST_MM,
  CANONICAL_OFFSET_NORTH_MM,
  CANONICAL_OFFSET_SOUTH_MM,
  CANONICAL_OFFSET_WEST_MM,
  CANONICAL_SITE_DEPTH_MM,
  CANONICAL_SITE_WIDTH_MM,
  GARAGE_MIN_DEPTH_MM,
  GARAGE_MIN_WIDTH_MM,
} from "./constants.ts";
import { normalizeProject } from "./normalization.ts";
import type { Offset, ProjectBrief, RoomRequirement, SiteBrief } from "./model.ts";

const offset = (distanceMm: number, source: Offset["source"] = "architect"): Offset => ({
  distanceMm,
  source,
});

const canonicalSite = (): SiteBrief => ({
  widthMm: CANONICAL_SITE_WIDTH_MM,
  depthMm: CANONICAL_SITE_DEPTH_MM,
  offsets: {
    north: offset(CANONICAL_OFFSET_NORTH_MM),
    east: offset(CANONICAL_OFFSET_EAST_MM),
    south: offset(CANONICAL_OFFSET_SOUTH_MM),
    west: offset(CANONICAL_OFFSET_WEST_MM),
  },
  frontSide: "south",
});

const requiredRoom = (
  value: Omit<RoomRequirement, "inclusion">,
): RoomRequirement => ({ ...value, inclusion: "required" });

const canonicalProgram = (): RoomRequirement[] => [
  requiredRoom({
    id: "bedroom",
    label: "Bedroom",
    kind: "bedroom",
    quantity: 3,
    dimensions: { minAreaMm2: 10_000_000, minShortSideMm: 3_000 },
    traits: {
      zone: "private",
      wet: false,
      exteriorPreference: "high",
      mayBePassThrough: false,
    },
  }),
  requiredRoom({
    id: "bathroom",
    label: "Bathroom",
    kind: "bathroom",
    quantity: 1,
    dimensions: { minAreaMm2: 5_000_000 },
    traits: {
      zone: "service",
      wet: true,
      exteriorPreference: "low",
      mayBePassThrough: false,
    },
  }),
  requiredRoom({
    id: "kitchen",
    label: "Kitchen",
    kind: "kitchen",
    quantity: 1,
    dimensions: { minAreaMm2: 12_000_000 },
    traits: {
      zone: "public",
      wet: true,
      exteriorPreference: "medium",
      mayBePassThrough: true,
    },
  }),
  requiredRoom({
    id: "living",
    label: "Living Room",
    kind: "living",
    quantity: 1,
    dimensions: { minAreaMm2: 20_000_000 },
    traits: {
      zone: "public",
      wet: false,
      exteriorPreference: "high",
      mayBePassThrough: true,
    },
  }),
  requiredRoom({
    id: "laundry",
    label: "Laundry",
    kind: "laundry",
    quantity: 1,
    dimensions: { minAreaMm2: 5_000_000 },
    traits: {
      zone: "service",
      wet: true,
      exteriorPreference: "low",
      mayBePassThrough: false,
    },
  }),
  requiredRoom({
    id: "garage",
    label: "Garage",
    kind: "garage",
    quantity: 1,
    dimensions: {
      minAreaMm2: GARAGE_MIN_WIDTH_MM * GARAGE_MIN_DEPTH_MM,
      minWidthMm: GARAGE_MIN_WIDTH_MM,
      minDepthMm: GARAGE_MIN_DEPTH_MM,
    },
    traits: {
      zone: "service",
      wet: false,
      exteriorPreference: "none",
      mayBePassThrough: false,
      frontage: { side: "south", kind: "vehicle" },
      vehicleSpaces: 2,
    },
  }),
];

export function createCanonicalProject(seed = "canonical-0"): ProjectBrief {
  return {
    schemaVersion: 1,
    projectId: "canonical-planlab-project",
    name: "PlanLab canonical prototype",
    site: canonicalSite(),
    program: canonicalProgram(),
    relationships: [
      {
        id: "kitchen-living-near",
        from: "kitchen",
        to: "living",
        kind: "preferShareWall",
        source: "architect",
      },
      {
        id: "bathroom-bedrooms-near",
        from: "bathroom",
        to: "bedroom",
        kind: "preferNear",
        source: "architect",
      },
    ],
    planning: {
      minimumCirculationWidthMm: 1_000,
      targetGfaMm2: 180_000_000,
      maxGfaMm2: 200_000_000,
      maxUnallocatedInteriorRatio: 0.05,
    },
    generation: { seed },
  };
}

export const CANONICAL_PROJECT = createCanonicalProject();
export const CANONICAL_NORMALIZED_PROJECT = normalizeProject(CANONICAL_PROJECT);

function impossibleEnvelopeProject(): ProjectBrief {
  const project = createCanonicalProject("impossible-envelope");
  project.site = {
    ...project.site,
    widthMm: 4_000,
    offsets: {
      ...project.site.offsets,
      west: offset(2_000),
      east: offset(2_000),
    },
  };
  return project;
}

function impossibleRoomProject(): ProjectBrief {
  const project = createCanonicalProject("impossible-room");
  project.program = [
    {
      id: "impossible-room",
      label: "Impossible Room",
      kind: "other",
      quantity: 1,
      inclusion: "required",
      dimensions: {
        minAreaMm2: 324_000_000,
        minWidthMm: 18_000,
        minDepthMm: 18_000,
      },
      traits: {
        zone: "public",
        wet: false,
        exteriorPreference: "none",
        mayBePassThrough: false,
      },
    },
  ];
  return project;
}

function impossibleProgramSizeProject(): ProjectBrief {
  const project = createCanonicalProject("impossible-program-size");
  project.program = [
    {
      id: "many-rooms",
      label: "Many Rooms",
      kind: "other",
      quantity: 25,
      inclusion: "required",
      dimensions: { minAreaMm2: 250_000 },
      traits: {
        zone: "private",
        wet: false,
        exteriorPreference: "none",
        mayBePassThrough: false,
      },
    },
  ];
  return project;
}

export const IMPOSSIBLE_FIXTURES = Object.freeze({
  envelopeConsumesSite: impossibleEnvelopeProject(),
  roomCannotFitEnvelope: impossibleRoomProject(),
  programExceedsInstanceLimit: impossibleProgramSizeProject(),
});
