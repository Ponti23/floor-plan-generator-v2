import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeProject,
  validateLayout,
  type AccessPortal,
  type GridRect,
  type Layout,
  type ProjectBrief,
  type RelationshipRequirement,
  type RoomRequirement,
  type SiteBrief,
} from "../src/domain/index.ts";

function rect(x: number, y: number, width: number, depth: number): GridRect {
  return { x, y, width, depth };
}

type FixtureSpace = { id: string; role: Layout["spaces"][number]["role"]; rect: GridRect };

function fixture(
  footprint: GridRect,
  spaces: readonly FixtureSpace[],
  portals: readonly AccessPortal[] = [],
): Layout {
  return {
    id: "relationship-fixture",
    footprint,
    spaces: spaces.map((space) => ({
      instanceId: space.id,
      role: space.role,
      rect: space.rect,
    })),
    portals: portals.slice(),
    entrancePortalId: portals[0]?.id ?? "entrance",
    metadata: {
      engineVersion: "test",
      ruleVersion: "test",
      seed: "test",
      topology: "straight",
      footprintVariant: "test",
      expandedStates: 0,
      candidateOrdinal: 0,
    },
  };
}

function room(
  id: string,
  kind: RoomRequirement["kind"],
  zone: RoomRequirement["traits"]["zone"],
  quantity = 1,
  frontage?: RoomRequirement["traits"]["frontage"],
): RoomRequirement {
  return {
    id,
    label: id,
    kind,
    quantity,
    inclusion: "required",
    dimensions: { minAreaMm2: 1_000_000 },
    traits: {
      zone,
      wet: kind === "bathroom",
      exteriorPreference: "none",
      mayBePassThrough: false,
      ...(frontage ? { frontage } : {}),
    },
  };
}

function brief(
  program: RoomRequirement[],
  options: {
    relationships?: RelationshipRequirement[];
    siteMm?: { widthMm: number; depthMm: number };
    minimumCirculationWidthMm?: number;
  } = {},
): ProjectBrief {
  const size = options.siteMm ?? { widthMm: 5_000, depthMm: 2_500 };
  const site: SiteBrief = {
    widthMm: size.widthMm,
    depthMm: size.depthMm,
    offsets: {
      north: { distanceMm: 0, source: "architect" },
      east: { distanceMm: 0, source: "architect" },
      south: { distanceMm: 0, source: "architect" },
      west: { distanceMm: 0, source: "architect" },
    },
    frontSide: "south",
  };
  return {
    schemaVersion: 1,
    projectId: "relationship-rules",
    name: "Relationship rules",
    site,
    program,
    relationships: options.relationships ?? [],
    planning: {
      minimumCirculationWidthMm: options.minimumCirculationWidthMm ?? 1_000,
      maxUnallocatedInteriorRatio: 0.05,
    },
    generation: { seed: "relationship-rules" },
  };
}

function codes(layout: Layout, project: ProjectBrief): string[] {
  return validateLayout(layout, normalizeProject(project)).violations.map(
    (violation) => violation.code,
  );
}

function relationship(
  kind: RelationshipRequirement["kind"],
  aggregation: RelationshipRequirement["aggregation"],
  from: RelationshipRequirement["from"],
  to: RelationshipRequirement["to"],
  minSharedWallM?: number,
): RelationshipRequirement {
  return {
    id: "rel-1",
    from,
    to,
    kind,
    aggregation,
    ...(minSharedWallM === undefined ? {} : { minSharedWallM }),
    source: "architect",
  };
}

/**
 * A 20 × 10 footprint (5 m × 2.5 m) whose wall contacts are hand-checked:
 * bedroom-1|bedroom-2 share 10 units, bedroom-2|bedroom-3 share 4 units,
 * bedroom-2|living-1 share 6 units, bedroom-3|living-1 share 5 units, and
 * bedroom-1 touches neither bedroom-3 nor living-1.
 */
const WALL_FOOTPRINT = rect(0, 0, 20, 10);

const WALL_SPACES: FixtureSpace[] = [
  { id: "bedroom-1", role: "room", rect: rect(0, 0, 5, 10) },
  { id: "bedroom-2", role: "room", rect: rect(5, 0, 5, 10) },
  { id: "bedroom-3", role: "room", rect: rect(10, 0, 5, 4) },
  { id: "living-1", role: "room", rect: rect(10, 4, 5, 6) },
];

const WALL_PROGRAM: RoomRequirement[] = [
  room("bedroom", "bedroom", "private", 3),
  room("living", "living", "public"),
];

const KIND = (kind: RoomRequirement["kind"]): RelationshipRequirement["from"] => ({
  type: "kind",
  kind,
});

const INSTANCE = (id: string): RelationshipRequirement["from"] => ({ type: "instance", id });

test("`any` aggregation is satisfied by one qualifying pair and by nothing less", () => {
  const layout = fixture(WALL_FOOTPRINT, WALL_SPACES);
  const satisfied = codes(
    layout,
    brief(WALL_PROGRAM, {
      relationships: [relationship("mustShareWall", "any", KIND("bedroom"), KIND("bedroom"))],
    }),
  );
  assert.equal(satisfied.includes("MUST_SHARE_WALL_UNSATISFIED"), false);

  // bedroom-1 and bedroom-3 do not touch at all.
  const unsatisfied = codes(
    layout,
    brief(WALL_PROGRAM, {
      relationships: [
        relationship("mustShareWall", "any", INSTANCE("bedroom-1"), INSTANCE("bedroom-3")),
      ],
    }),
  );
  assert.ok(unsatisfied.includes("MUST_SHARE_WALL_UNSATISFIED"));
});

test("`all` aggregation fails when any expanded pair fails, where `any` would pass", () => {
  const layout = fixture(WALL_FOOTPRINT, WALL_SPACES);
  const relations = (aggregation: RelationshipRequirement["aggregation"]) => [
    relationship("mustShareWall", aggregation, KIND("bedroom"), KIND("bedroom")),
  ];

  const any = codes(layout, brief(WALL_PROGRAM, { relationships: relations("any") }));
  const all = codes(layout, brief(WALL_PROGRAM, { relationships: relations("all") }));

  // bedroom-1 sits well away from bedroom-3, so `all` cannot hold.
  assert.equal(any.includes("MUST_SHARE_WALL_UNSATISFIED"), false);
  assert.ok(all.includes("MUST_SHARE_WALL_UNSATISFIED"));

  // A single expanded pair satisfies both aggregations.
  const singlePair = [
    relationship("mustShareWall", "all", INSTANCE("bedroom-1"), INSTANCE("bedroom-2")),
  ];
  const allSingle = codes(layout, brief(WALL_PROGRAM, { relationships: singlePair }));
  assert.equal(allSingle.includes("MUST_SHARE_WALL_UNSATISFIED"), false);
});

test("distance aggregations on a hard wall rule are reported, never silently passed", () => {
  const layout = fixture(WALL_FOOTPRINT, WALL_SPACES);
  for (const aggregation of ["nearest", "average"] as const) {
    const result = codes(
      layout,
      brief(WALL_PROGRAM, {
        relationships: [
          relationship("mustShareWall", aggregation, INSTANCE("bedroom-1"), INSTANCE("bedroom-3")),
        ],
      }),
    );
    assert.ok(
      result.includes("RELATIONSHIP_AGGREGATION_UNSUPPORTED"),
      `${aggregation} must be reported as unsupported`,
    );
    // One defect produces one finding: the pair-level rule stays silent.
    assert.equal(result.includes("MUST_SHARE_WALL_UNSATISFIED"), false);
  }
});

test("must-share-wall means real wall contact: not a corner, not a doorway, not too short", () => {
  const threshold = (minSharedWallM: number) => [
    relationship(
      "mustShareWall",
      "any",
      INSTANCE("bedroom-1"),
      INSTANCE("bedroom-2"),
      minSharedWallM,
    ),
  ];
  const layout = fixture(WALL_FOOTPRINT, WALL_SPACES);

  // bedroom-1 and bedroom-2 share exactly 10 units (2.5 m).
  assert.equal(
    codes(layout, brief(WALL_PROGRAM, { relationships: threshold(2.5) })).includes(
      "MUST_SHARE_WALL_UNSATISFIED",
    ),
    false,
  );
  assert.ok(
    codes(layout, brief(WALL_PROGRAM, { relationships: threshold(2.75) })).includes(
      "MUST_SHARE_WALL_UNSATISFIED",
    ),
  );

  // Corner contact only: the two spaces meet at a single point.
  const corner = fixture(rect(0, 0, 12, 12), [
    { id: "bedroom-1", role: "room", rect: rect(0, 0, 5, 5) },
    { id: "bedroom-2", role: "room", rect: rect(5, 5, 5, 5) },
  ]);
  const cornerCodes = codes(
    corner,
    brief(
      [room("bedroom", "bedroom", "private", 2)],
      {
        relationships: [
          relationship("mustShareWall", "any", INSTANCE("bedroom-1"), INSTANCE("bedroom-2")),
        ],
      },
    ),
  );
  assert.ok(cornerCodes.includes("MUST_SHARE_WALL_UNSATISFIED"));
});

test("an unresolved or self-referential selector never satisfies a wall relationship", () => {
  const layout = fixture(WALL_FOOTPRINT, WALL_SPACES);

  // First layer: the authored boundary rejects a selector that matches nothing.
  const authored = brief(WALL_PROGRAM, {
    relationships: [
      relationship("mustShareWall", "any", INSTANCE("bedroom-1"), INSTANCE("ghost-1")),
    ],
  });
  assert.throws(() => normalizeProject(authored), /UNRESOLVED_RELATIONSHIP_SELECTOR/);

  // Second layer: a normalized project can be supplied directly to the domain
  // API, and then the validator must report the unresolved selector instead of
  // treating the relationship as satisfied.
  const normalized = structuredClone(normalizeProject(brief(WALL_PROGRAM)));
  normalized.relationships = [
    relationship("mustShareWall", "any", INSTANCE("bedroom-1"), INSTANCE("ghost-1")),
  ];
  const unresolved = validateLayout(layout, normalized).violations.map(
    (violation) => violation.code,
  );
  assert.ok(unresolved.includes("RELATIONSHIP_SELECTOR_UNRESOLVED"));
  assert.equal(unresolved.includes("MUST_SHARE_WALL_UNSATISFIED"), false);

  // `all` over an empty expansion must not be vacuously true.
  const selfPair = codes(
    layout,
    brief(WALL_PROGRAM, {
      relationships: [
        relationship("mustShareWall", "all", INSTANCE("bedroom-1"), INSTANCE("bedroom-1")),
      ],
    }),
  );
  assert.ok(selfPair.includes("MUST_SHARE_WALL_UNSATISFIED"));
});

/** A 48 × 48 footprint (12 m × 12 m) is large enough for the 6 m garage preset. */
const GARAGE_FOOTPRINT = rect(0, 0, 48, 48);

const GARAGE_PROGRAM: RoomRequirement[] = [
  room("garage", "garage", "service", 1, { side: "south", kind: "vehicle" }),
];

function garageLayout(garageRect: GridRect, withVehiclePortal: boolean): Layout {
  const spaces: FixtureSpace[] = [{ id: "garage-1", role: "room", rect: garageRect }];
  const portals: AccessPortal[] = withVehiclePortal
    ? [{
      id: "p-vehicle",
      a: "exterior",
      b: "garage-1",
      wall: "south",
      start: garageRect.x,
      length: 4,
      kind: "vehicle",
    }]
    : [];
  return fixture(GARAGE_FOOTPRINT, spaces, portals);
}

test("garage rules are hard: south frontage, vehicle portal, and the 6 m preset", () => {
  const compliant = garageLayout(rect(0, 24, 24, 24), true).id;
  assert.equal(compliant, "relationship-fixture");
  const compliantCodes = codes(garageLayout(rect(0, 24, 24, 24), true), brief(GARAGE_PROGRAM));
  assert.deepEqual(
    compliantCodes.filter((code) => code.startsWith("GARAGE_")),
    [],
  );

  // Parked away from the south boundary: frontage and portal both fail.
  const inland = codes(garageLayout(rect(0, 0, 24, 24), false), brief(GARAGE_PROGRAM));
  assert.ok(inland.includes("GARAGE_MISSING_SOUTH_FRONTAGE"));
  assert.ok(inland.includes("GARAGE_VEHICLE_PORTAL_MISSING"));

  // On the south boundary but under the preset width.
  const narrow = codes(garageLayout(rect(0, 24, 20, 24), true), brief(GARAGE_PROGRAM));
  assert.ok(narrow.includes("GARAGE_PRESET_DIMENSIONS_INVALID"));
});

test("minimum circulation width uses the project setting", () => {
  const layout = (widthUnits: number) =>
    fixture(rect(0, 0, 12, 12), [
      { id: "hall-1", role: "circulation", rect: rect(0, 0, widthUnits, 8) },
    ]);
  // 1 m at the approved 250 mm grid is 4 units.
  const tooNarrow = codes(layout(3), brief([], { siteMm: { widthMm: 3_000, depthMm: 3_000 } }));
  const exact = codes(layout(4), brief([], { siteMm: { widthMm: 3_000, depthMm: 3_000 } }));

  assert.ok(tooNarrow.includes("CIRCULATION_WIDTH_INVALID"));
  assert.equal(exact.includes("CIRCULATION_WIDTH_INVALID"), false);
});

test("multiple simultaneous defects are reported together, stably and in pipeline order", () => {
  const layout = fixture(WALL_FOOTPRINT, [
    // Two spaces overlap, one portal is fiction, and the garage-like room sits
    // nowhere near the south boundary.
    { id: "bedroom-1", role: "room", rect: rect(0, 0, 5, 10) },
    { id: "bedroom-2", role: "room", rect: rect(3, 0, 5, 10) },
    { id: "bedroom-3", role: "room", rect: rect(10, 0, 5, 4) },
  ], [
    { id: "p-bogus", a: "bedroom-1", b: "bedroom-3", wall: "south", start: 0, length: 4, kind: "pedestrian" },
  ]);
  const project = brief(WALL_PROGRAM, {
    relationships: [
      relationship("mustShareWall", "all", KIND("bedroom"), KIND("bedroom")),
    ],
  });

  const first = validateLayout(layout, normalizeProject(project));
  const second = validateLayout(layout, normalizeProject(project));
  const firstCodes = first.violations.map((violation) => violation.code);

  for (const expected of [
    "SPACE_OVERLAP",
    "PORTAL_NOT_ON_SHARED_EDGE",
    "MUST_SHARE_WALL_UNSATISFIED",
  ]) {
    assert.ok(firstCodes.includes(expected), `missing ${expected}`);
  }
  // Deterministic: same input, byte-identical violations.
  assert.deepEqual(JSON.parse(JSON.stringify(first.violations)), JSON.parse(JSON.stringify(second.violations)));
  // Pipeline order: coverage/geometry before portal findings before relationships.
  assert.ok(firstCodes.indexOf("SPACE_OVERLAP") < firstCodes.indexOf("PORTAL_NOT_ON_SHARED_EDGE"));
  assert.ok(
    firstCodes.indexOf("PORTAL_NOT_ON_SHARED_EDGE") <
      firstCodes.indexOf("MUST_SHARE_WALL_UNSATISFIED"),
  );
});
