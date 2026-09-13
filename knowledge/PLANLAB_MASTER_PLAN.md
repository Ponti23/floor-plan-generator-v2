# PLANLAB — ARCHITECTURAL CONCEPT LAYOUT GENERATOR

## YOUR ROLE

Act as the senior product architect, software architect, computational geometry engineer, and technical lead for a new web application called **PlanLab**.

We are currently in the **PLANNING PHASE ONLY**.

DO NOT start building the application.

DO NOT generate a full implementation.

DO NOT scaffold the project.

DO NOT install packages.

DO NOT create React components yet.

DO NOT prematurely decide that an AI/LLM should generate floor-plan coordinates.

Your job is to help me thoroughly plan the product and technical architecture before implementation begins.

Challenge weak assumptions.

If something I propose is technically poor, architecturally fragile, unnecessarily complicated, or inappropriate for an MVP, say so and recommend something better.

At the end, I want a detailed technical plan that another coding agent could follow milestone-by-milestone.

---

# 1. PRODUCT IDEA

PlanLab is a browser-based conceptual floor-plan generation tool aimed initially at architects.

An architect enters:

* lot/site dimensions
* offsets around the site
* required rooms
* room quantities
* room minimum dimensions
* room minimum areas
* room relationships
* circulation requirements
* design preferences
* other constraints

PlanLab then generates multiple conceptual floor-plan arrangements.

For the MVP:

**Generate 3 recommended layouts.**

The three layouts should be valid according to the selected hard constraints while representing meaningfully different design strategies.

Example:

### Option A — Maximum Efficiency

Prioritizes:

* usable floor area
* reduced wasted space
* compact footprint

### Option B — Best Flow

Prioritizes:

* adjacency
* circulation
* accessibility
* logical room relationships

### Option C — Balanced

Balances:

* space efficiency
* circulation
* adjacency
* privacy
* room proportions
* other design preferences

The application is NOT intended to produce construction-ready architectural drawings.

It generates **conceptual / schematic layouts**.

---

# 2. CORE USER FLOW

The basic workflow should eventually be:

1. Architect opens PlanLab.
2. No login is required.
3. Architect enters site dimensions.
4. Architect enters site offsets.
5. Architect specifies required rooms.
6. Architect configures room constraints.
7. Architect configures general design rules.
8. Architect clicks "Generate 3 Layouts".
9. PlanLab generates candidate layouts.
10. Invalid candidates are rejected.
11. Valid candidates are scored.
12. Similar layouts are deduplicated.
13. Three meaningfully different high-scoring layouts are returned.
14. Architect compares them visually.
15. Architect selects one.
16. Architect can inspect why it received its score.
17. Project state automatically persists in the browser.
18. Refreshing/reopening the site restores the previous project.

Future versions may allow:

* locking rooms
* dragging rooms
* resizing rooms
* regenerating surrounding spaces
* natural-language instructions
* automatic planning-code rule packs
* export
* collaboration
* accounts/projects
* cloud persistence

These are NOT MVP requirements unless needed architecturally.

---

# 3. MVP DEPLOYMENT PHILOSOPHY

Keep the first version extremely simple to deploy.

Preferred stack:

* Next.js
* React
* TypeScript
* Tailwind CSS
* SVG for floor-plan visualization
* browser storage
* GitHub
* Vercel

Avoid a backend unless there is a strong technical reason for one.

For MVP assume:

NO:

* authentication
* database
* Supabase
* PostgreSQL
* Python backend
* microservices
* Docker requirement
* vector database
* LLM requirement
* user accounts

Persistence should initially use:

localStorage

If you believe IndexedDB is more appropriate for some state, explain why and where it should be used.

---

# 4. IMPORTANT SITE MODEL

The architect specifically requested **offsets around all sides of the site**.

Think of these like padding around the lot.

Example:

Lot:

20m wide
30m deep

Offsets:

Front / South: 6m
Rear / North: 2m
Left / West: 1.5m
Right / East: 1.5m

This creates an inner buildable envelope.

Example:

LOT BOUNDARY

┌──────────────────────────────────┐
│             REAR                 │
│             2.0m                 │
│                                  │
│    ┌────────────────────────┐    │
│    │                        │    │
│ L  │    BUILDABLE AREA      │ R  │
│ E  │                        │ I  │
│ F  │                        │ G  │
│ T  │                        │ H  │
│    │                        │ T  │
│    └────────────────────────┘    │
│                                  │
│             6.0m                 │
│             FRONT                │
└──────────────────────────────────┘

```
            STREET
              ↓
           SOUTH
```

For the MVP:

* entrance/front is always SOUTH
* visually SOUTH is always at the BOTTOM
* NORTH is always at the TOP

Important:

Do not assume "offset" automatically means a statutory planning setback.

An offset may be:

* architect-defined
* project-specific
* planning-derived
* custom

Internally the system should be able to record the source.

Example:

source:

* architect
* planning
* system
* custom

The generator MUST NOT place the building footprint outside the buildable envelope.

This is a HARD constraint.

---

# 5. COORDINATE SYSTEM

Plan a consistent coordinate system.

For example:

origin = top-left or bottom-left

But choose one intentionally and explain why.

We need predictable definitions for:

* x
* y
* width
* depth
* north
* south
* east
* west
* site boundary
* buildable envelope
* room rectangle
* wall
* entrance

South must visually appear at the bottom.

North must visually appear at the top.

The internal model and SVG rendering model should not become confused about Y-axis direction.

Explicitly design this.

---

# 6. GRID SYSTEM

The generator should operate on a discrete grid rather than arbitrary floating-point coordinates.

Initial proposed resolution:

**1 grid cell = 0.25 metres**

Therefore:

4 cells = 1 metre

Example:

20m × 30m site

becomes:

80 × 120 grid cells.

Analyze whether 0.25m is a sensible MVP grid resolution.

Discuss tradeoffs involving:

* computational complexity
* architectural usefulness
* room dimension flexibility
* candidate generation
* rendering
* future precision

If another internal representation would be better, explain it.

Avoid floating-point geometry problems wherever practical.

---

# 7. ROOM MODEL

A room requirement should support something conceptually similar to:

```ts
type RoomRequirement = {
  id: string;
  name: string;

  type:
    | "bedroom"
    | "bathroom"
    | "kitchen"
    | "living"
    | "dining"
    | "laundry"
    | "garage"
    | "hallway"
    | "study"
    | "storage"
    | "outdoor"
    | "other";

  quantity: number;

  minArea?: number;
  preferredArea?: number;

  minWidth?: number;
  preferredWidth?: number;

  minDepth?: number;
  preferredDepth?: number;

  maxAspectRatio?: number;

  requiresExteriorWall?: boolean;

  priority:
    | "required"
    | "preferred";
};
```

Do NOT blindly use this model.

Review it.

Identify problems.

Improve it.

In particular think about whether:

quantity: 3

should internally become:

Bedroom 1
Bedroom 2
Bedroom 3

before generation.

Also consider special properties required by:

* garage
* hallway
* outdoor living
* ensuite
* WC
* entry
* pantry
* wardrobes/storage

Do not overengineer V1.

---

# 8. RULE SYSTEM

This is one of the most important architectural parts of PlanLab.

We need a generic rule engine.

Rules should conceptually fall into three categories:

## HARD CONSTRAINT

Violation makes a candidate invalid.

Examples:

* rooms overlap
* building crosses buildable envelope
* room below required minimum area
* room below required minimum width
* inaccessible room
* required adjacency missing
* garage cannot access appropriate frontage
* circulation route impossible

## DESIGN PREFERENCE

Violation is allowed but reduces the score.

Examples:

* kitchen farther from living room
* bathroom farther from bedrooms
* bedroom near garage
* excessively long hallway
* poor privacy zoning
* poor room proportions

## OPTIMIZATION OBJECTIVE

Something PlanLab actively tries to maximize/minimize.

Examples:

* maximize usable area
* minimize circulation area
* minimize wasted space
* maximize adjacency quality
* maximize exterior-wall allocation
* maximize natural-light opportunity
* minimize plumbing/service spread

Design a Rule abstraction.

Conceptually something like:

```ts
type Rule = {
  id: string;

  name: string;

  category:
    | "site"
    | "room"
    | "circulation"
    | "adjacency"
    | "orientation"
    | "privacy"
    | "accessibility"
    | "parking"
    | "services";

  severity:
    | "required"
    | "preferred"
    | "optimization";

  weight?: number;

  source:
    | "architect"
    | "planlab"
    | "planning"
    | "building_code"
    | "custom";

  enabled: boolean;
};
```

Again:

Do NOT blindly accept this.

Improve the architecture if necessary.

The rule system should eventually support versioned rule packs, but DO NOT implement regulatory automation in the MVP.

---

# 9. ROOM RELATIONSHIPS / ADJACENCY

PlanLab must understand relationships between rooms.

Examples:

Kitchen:

* strongly prefer adjacent to Living
* prefer near Dining
* prefer near Garage

Bathroom:

* prefer near Bedrooms

Garage:

* prefer near Entry
* prefer near Kitchen/Laundry
* avoid Bedrooms

Bedrooms:

* prefer grouped together
* avoid Garage
* prefer exterior wall

Represent these relationships in a generic way.

Consider whether we need:

* MUST_ADJACENT
* PREFER_ADJACENT
* PREFER_NEAR
* AVOID_ADJACENT
* KEEP_SEPARATE

Define what "adjacent" actually means geometrically.

For example:

Two rectangles merely touching at one corner should NOT necessarily count as meaningfully adjacent.

Consider shared-wall length.

Potential model:

sharedWallLength >= threshold

Also distinguish:

adjacency

from:

distance.

Plan this carefully.

---

# 10. CIRCULATION

Do not treat hallways as random leftover rectangles.

Plan circulation intentionally.

Every occupiable room should have a valid route to the entrance.

Potential circulation rules:

* every room must be reachable
* avoid rooms accessible only through unrelated private rooms
* minimize dead-end hallways
* minimum hallway width
* minimize hallway area
* minimize total circulation distance
* logical transition between public and private areas

Think about representing the floor plan as both:

GEOMETRY

and

GRAPH.

Example graph:

Entrance
|
Living
|
Hallway
/ | 
B1 B2 B3
|
Bathroom

Consider using graph algorithms for connectivity.

Explain how geometry and graph representation should interact.

---

# 11. PRIVACY / ZONING

PlanLab should eventually understand rough functional zones.

Example:

PUBLIC

* Entry
* Living
* Dining
* Kitchen

TRANSITION / SERVICE

* Hallway
* Bathroom
* Laundry
* Storage

PRIVATE

* Bedrooms
* Ensuite
* Study where applicable

Layouts can receive higher scores for sensible zoning.

For MVP this can remain a soft scoring heuristic.

Plan how it should work without making it too complex.

---

# 12. EXTERIOR WALL VALUE

Not every room deserves exterior-wall access equally.

Example priorities:

Living: HIGH
Bedrooms: HIGH
Kitchen: MEDIUM/HIGH
Bathroom: MEDIUM
Laundry: LOW
Storage: NONE
Hallway: NONE

The generator should eventually reward useful allocation of exterior walls.

This may later support:

* windows
* daylight
* ventilation
* views
* solar orientation

For MVP we can simply model whether a room touches the exterior footprint.

Plan how this can be calculated.

---

# 13. ORIENTATION / SOLAR

The coordinate system must preserve cardinal orientation.

For the initial prototype:

NORTH = TOP
SOUTH = BOTTOM
EAST = RIGHT
WEST = LEFT

The system should eventually support rules such as:

* prefer living area toward north
* prefer outdoor living toward north
* avoid wasting premium exterior orientation on circulation/storage

Do NOT attempt sophisticated solar simulation in MVP.

We only need architecture that won't prevent this later.

---

# 14. GARAGE

Garage should not behave exactly like a normal room.

Properties may include:

* number of car spaces
* minimum dimensions
* must connect toward street/front
* prefer internal access
* prefer proximity to kitchen/laundry
* avoid bedroom adjacency
* driveway relationship

For MVP:

Front/street = SOUTH.

The garage should generally have access toward SOUTH.

Plan how garage constraints differ from standard room constraints.

---

# 15. SERVICES / WET AREAS

PlanLab should eventually reward efficient clustering of:

* kitchen
* bathroom
* ensuite
* WC
* laundry

This can become:

Services Efficiency Score

For MVP, use a simple heuristic.

For example:

reward wet rooms sharing walls or being within a certain Manhattan/Euclidean distance.

Do not attempt plumbing design.

---

# 16. WASTED SPACE

One important optimization target is reducing unusable or awkward leftover space.

We need definitions for:

* usable room area
* circulation area
* allocated area
* unallocated interior area
* building footprint
* site area
* buildable-envelope area

Potential metrics:

Site Area
Buildable Area
Building Footprint
Usable Room Area
Circulation Area
Unallocated Area
Efficiency %

Think carefully about what "efficiency" should mathematically mean.

Do NOT create misleading metrics.

Document every formula.

---

# 17. FLOOR PLAN REPRESENTATION

A generated layout may conceptually contain:

```ts
type PlacedRoom = {
  id: string;
  requirementId: string;

  x: number;
  y: number;

  width: number;
  depth: number;
};
```

But review this.

We need enough information to calculate:

* bounds
* area
* collisions
* shared walls
* exterior-wall contact
* room centers
* distances
* connectivity
* dimensions

For MVP rooms may remain axis-aligned rectangles.

That is acceptable.

Explicitly decide whether irregular/L-shaped rooms should be OUT OF SCOPE for MVP.

My preference:

V1 = axis-aligned rectangles only.

---

# 18. GENERATION ENGINE

This is the biggest technical planning problem.

DO NOT assume an LLM generates coordinates.

I strongly prefer a deterministic / algorithmic / optimization-based layout engine.

The conceptual pipeline is:

Input Brief
↓
Normalize Requirements
↓
Create Room Instances
↓
Create Constraints
↓
Generate Candidate Layouts
↓
Validate Hard Constraints
↓
Score Valid Candidates
↓
Deduplicate Similar Candidates
↓
Cluster by Design Strategy
↓
Return Best 3

Research/reason about appropriate algorithms for an MVP.

Consider options such as:

* randomized placement
* greedy placement
* recursive partitioning
* slicing floor plans
* simulated annealing
* genetic algorithms
* constraint satisfaction
* constraint programming
* integer programming
* beam search
* hybrid approaches

We are building this primarily in TypeScript and ideally running generation in the browser.

Evaluate these approaches based on:

* implementation complexity
* runtime
* quality
* debuggability
* determinism
* browser suitability
* ability to respect hard constraints
* ability to produce diverse layouts
* ability to improve later

Recommend ONE primary MVP strategy.

You may recommend a hybrid.

Explain why.

---

# 19. DETERMINISM

We need reproducible generation for debugging.

Plan for seeded randomness.

Example:

generateLayouts(project, seed)

Same:

project + seed

should ideally generate the same candidate set.

Explain how we should implement this.

Do not rely on Math.random() throughout the solver.

---

# 20. CANDIDATE VALIDATION

Design a validation pipeline.

Potential checks:

SITE

* inside buildable envelope

GEOMETRY

* no room overlap
* valid dimensions
* no zero-area spaces

ROOM REQUIREMENTS

* minimum area
* minimum width
* minimum depth

CIRCULATION

* reachable rooms
* valid entrance
* minimum hallway width

SPECIAL ROOMS

* garage frontage

RELATIONSHIPS

* required adjacency

Return structured validation results.

Example concept:

```ts
{
  valid: false,
  violations: [
    {
      ruleId: "ROOM_MIN_WIDTH",
      roomId: "bedroom-2",
      expected: 3,
      actual: 2.75
    }
  ]
}
```

Plan this architecture.

---

# 21. SCORING ENGINE

Hard constraints should NOT merely reduce score.

They should invalidate a candidate.

Valid candidates then receive design scores.

Potential categories:

SPACE

* space utilization
* room proportions
* wasted space

FLOW

* circulation
* adjacency
* entrance flow

LIVEABILITY

* privacy
* exterior-wall allocation
* orientation

SERVICES

* wet-area clustering
* garage relationship

SITE

* footprint efficiency
* envelope usage

Do not create arbitrary fake precision.

Design normalized scoring.

For example:

0–100 per category

with transparent formulas.

Then weighted score.

Potential:

overall =
space * weight +
flow * weight +
liveability * weight +
services * weight +
site * weight

Recommend initial weights.

Also allow different weights for:

MAX EFFICIENCY

BEST FLOW

BALANCED

The same valid candidate may score differently depending on strategy.

---

# 22. THREE DIFFERENT RESULTS

This is important.

Do NOT simply return the top three scores if they are almost identical.

We need meaningful diversity.

For example:

Option A — Max Area
Option B — Best Flow
Option C — Balanced

Plan a layout similarity metric.

Potential signals:

* room centroid positions
* room adjacency graph
* room ordering
* footprint shape
* normalized coordinates

If two layouts are nearly identical, one should be discarded.

Recommend a simple MVP diversity/deduplication approach.

---

# 23. EXPLAINABILITY

Architects should be able to understand why a layout scored well or poorly.

Example:

Option A

92 / 100

Space Utilization      94
Room Requirements      PASS
Adjacency              89
Circulation            86
Room Proportions       93
Entrance Accessibility PASS

Observations:

✓ Kitchen adjacent to living area
✓ All bedrooms meet minimum area
✓ Garage positioned near entrance
⚠ Bathroom relatively far from Bedroom 3

Plan the data structures required so the scoring engine can produce explanations automatically.

Do not hardcode explanatory text directly in React components.

---

# 24. UI CONCEPT

The visual direction is a professional architectural workspace.

Think:

* CAD
* Figma
* Excalidraw
* engineering/design tools

NOT:

* generic SaaS dashboard
* giant cards
* huge gradients
* excessive rounded UI
* "AI startup" aesthetic

Desktop-first.

Main layout:

TOP TOOLBAR

LEFT CONFIGURATION PANEL

CENTER FLOOR PLAN CANVAS

RIGHT RESULTS / ANALYSIS PANEL

The canvas should dominate the screen.

Approximately 60–75% of usable visual attention should be on the floor plan.

---

# 25. LEFT PANEL

Potential sections:

SITE

* width
* depth
* orientation

OFFSETS

* front/south
* rear/north
* left/west
* right/east

ROOMS

* room list
* quantity
* min area
* expandable advanced settings

CONSTRAINTS

* hallway width
* grid resolution
* design preferences

OPTIMIZATION

* balanced
* efficiency
* flow

Generate button:

Generate 3 Layouts

---

# 26. CENTER CANVAS

Use SVG unless you recommend something better.

Display:

* subtle architectural grid
* lot boundary
* buildable-envelope boundary
* generated building footprint
* room boundaries
* room labels
* room areas
* dimensions
* entrance
* north indicator
* offset dimensions
* scale

Potential controls:

* zoom in
* zoom out
* fit
* grid toggle
* measurements toggle

Important:

The LOT BOUNDARY and BUILDABLE ENVELOPE must visually look different.

Example:

lot boundary = stronger/dashed outer line

buildable envelope = secondary inner line

building footprint = solid wall line

---

# 27. RIGHT PANEL

Show:

Option A
Max Area

Option B
Best Flow

Option C
Balanced

Selecting one updates the canvas.

Show metrics such as:

Overall Score
Usable Area
Footprint Area
Efficiency
Circulation Area

Score Breakdown

Observations

Rule Check

Example:

RULE CHECK

27 passed
3 warnings
0 violations

Do NOT represent compliance as:

"87% compliant"

Hard compliance/rule checks should be PASS/WARNING/FAIL.

---

# 28. LOCAL PERSISTENCE

No login.

No database.

Project should automatically persist locally.

Plan:

* what gets persisted
* when autosave occurs
* schema versioning
* handling corrupt state
* Reset Project
* migration strategy if local schema changes

Do not overengineer it.

But include something like:

schemaVersion

from the beginning.

---

# 29. PERFORMANCE

Generation could become computationally expensive.

Plan for:

* keeping UI responsive
* generation progress
* cancellation
* time budget
* candidate budget
* Web Workers if appropriate

For example:

Generate for:

500ms
1 second
2 seconds

or until:

N valid candidates

Recommend an MVP strategy.

If a Web Worker would substantially improve architecture, say so.

---

# 30. TESTING

The geometry and solver code MUST be testable independently of React.

Plan tests for:

* rectangle intersection
* boundary checking
* grid conversion
* area
* shared-wall detection
* adjacency
* distance
* exterior-wall contact
* buildable envelope
* room validation
* connectivity
* scoring
* deterministic generation
* deduplication

Recommend testing tools appropriate for the stack.

---

# 31. CODE ORGANIZATION

I want strict separation between:

UI

GEOMETRY

RULE ENGINE

GENERATOR

VALIDATOR

SCORER

STORAGE

Do not put the algorithm into page.tsx.

Potential structure:

```text
src/

app/

components/

features/
  project/
  site/
  rooms/
  generator/
  results/

lib/

  geometry/
    grid.ts
    rectangle.ts
    collision.ts
    adjacency.ts
    distance.ts

  solver/
    generate.ts
    candidate.ts
    placement.ts
    mutations.ts
    diversity.ts

  rules/
    rule.ts
    siteRules.ts
    roomRules.ts
    circulationRules.ts
    adjacencyRules.ts

  scoring/
    score.ts
    spaceScore.ts
    flowScore.ts
    privacyScore.ts
    servicesScore.ts

  validation/
    validateLayout.ts

  storage/
    projectStorage.ts

types/

workers/

tests/
```

Review this structure.

Improve it.

Keep it understandable.

Avoid unnecessary enterprise architecture.

---

# 32. MVP SCOPE

We need to aggressively control scope.

Proposed MVP:

INCLUDE

* rectangular lot
* four offsets
* south/front entrance
* rectangular rooms
* room quantities
* minimum room dimensions
* minimum areas
* basic adjacency rules
* exterior-wall preference
* garage
* circulation
* three layouts
* scoring
* rule explanations
* SVG rendering
* local persistence
* GitHub
* Vercel

EXCLUDE

* accounts
* database
* collaboration
* multi-storey buildings
* irregular lot shapes
* curved walls
* L-shaped rooms
* structural engineering
* plumbing design
* electrical design
* detailed doors/windows
* BIM
* Revit integration
* DWG
* DXF
* automatic planning approval
* construction documents
* sophisticated solar simulation
* AI chat
* natural-language editing
* regulatory guarantee

Challenge this scope.

Tell me if anything currently marked INCLUDE should be deferred.

Tell me if anything important is missing.

---

# 33. REGULATORY POSITION

PlanLab MVP should NOT claim that generated plans are compliant architectural designs.

UI should display something subtle such as:

"Conceptual layout only — verify dimensions, regulations, site conditions and construction requirements before use."

The architecture may eventually support:

* WA planning rules
* NCC-related constraints
* local government rules
* architect-defined rule packs

But regulatory automation is NOT part of MVP.

The rule engine should nevertheless be designed so rule sources can eventually be attached.

---

# 34. FUTURE AI

Do not make an LLM responsible for geometry.

Potential future AI architecture:

Architect:

"Make the living room larger and keep bedrooms farther from the garage."

↓

LLM interprets intent

↓

Structured constraint changes

↓

Deterministic layout solver

↓

New layouts

This means the LLM acts as a natural-language interface to the constraint system.

It does NOT directly invent coordinates.

Ensure today's architecture would support this later.

Do not implement it now.

---

# 35. QUESTIONS YOU NEED TO ANSWER

Before implementation, I want you to explicitly answer:

1. What is the smallest genuinely useful PlanLab MVP?

2. What parts of this proposal are currently overengineered?

3. What important architectural requirements are missing?

4. What internal coordinate system should we use?

5. Should dimensions internally use metres, millimetres, or grid units?

6. Is 0.25m grid resolution appropriate?

7. How should the buildable envelope be represented?

8. How should rooms be represented?

9. How should circulation be represented?

10. How should adjacency be calculated?

11. How should exterior-wall contact be calculated?

12. How should offsets work?

13. How should the garage be modeled?

14. What should count as wasted space?

15. How should layout efficiency be calculated?

16. Which rules should be HARD constraints?

17. Which should be SOFT preferences?

18. What should the initial scoring formula be?

19. How should Max Area, Best Flow, and Balanced differ?

20. Which layout-generation algorithm should V1 use?

21. How many candidate layouts should we generate?

22. Should generation be time-budgeted or candidate-budgeted?

23. Should generation happen in a Web Worker?

24. How do we guarantee deterministic/reproducible results?

25. How do we determine whether two generated layouts are too similar?

26. How should rule explanations be generated?

27. What state belongs in localStorage?

28. What should NOT be stored?

29. How should project schema versioning work?

30. What geometry/solver tests are mandatory before connecting the UI?

31. What should the implementation milestones be?

32. What is the biggest technical risk?

33. What is the biggest product risk?

34. What should we prototype first to validate whether this idea actually works?

---

# 36. REQUIRED PLANNING DELIVERABLES

Create planning documents BEFORE implementation.

At minimum produce:

```text
docs/

PRODUCT_SPEC.md

MVP_SCOPE.md

ARCHITECTURE.md

DATA_MODEL.md

COORDINATE_SYSTEM.md

RULE_ENGINE.md

GENERATION_ENGINE.md

SCORING_SYSTEM.md

UI_ARCHITECTURE.md

TESTING_STRATEGY.md

IMPLEMENTATION_PLAN.md

OPEN_QUESTIONS.md
```

If fewer documents would be cleaner, consolidate them.

Do not create documentation merely for the sake of documentation.

The important thing is that the plan is understandable and implementable.

---

# 37. IMPLEMENTATION PLAN FORMAT

Break development into clear milestones.

My initial thinking is:

## MILESTONE 0 — Mathematical Prototype

Before building the polished application, prove that we can:

* represent a site
* apply offsets
* create a buildable envelope
* represent rooms
* place rectangles
* reject collisions
* validate minimum dimensions
* calculate adjacency
* calculate exterior-wall contact
* score layouts
* generate multiple candidates
* return three meaningfully different layouts

This may be done with tests/simple visualization rather than production UI.

## MILESTONE 1 — UI SHELL

Build:

* toolbar
* site panel
* offset controls
* room editor
* constraint editor
* SVG canvas
* right results panel

Use hardcoded layout data initially.

## MILESTONE 2 — GEOMETRY ENGINE

Build/test:

* grid
* rectangles
* collision
* bounds
* shared walls
* distance
* exterior walls
* site/buildable envelope

## MILESTONE 3 — RULE + VALIDATION ENGINE

Build:

* hard constraints
* soft preferences
* structured violations
* structured observations

## MILESTONE 4 — GENERATION ENGINE

Build:

* candidate generation
* seeded randomness
* mutations/placement
* validation
* candidate collection

## MILESTONE 5 — SCORING + DIVERSITY

Build:

* category scoring
* strategy weights
* layout similarity
* deduplication
* top-three selection

## MILESTONE 6 — UI INTEGRATION

Connect actual generator to UI.

## MILESTONE 7 — PERSISTENCE + POLISH

Add:

* autosave
* restore
* reset
* loading
* generation progress
* cancellation
* error states

## MILESTONE 8 — DEPLOY

* GitHub
* Vercel
* README
* production build verification

Review this sequence and improve it.

---

# 38. VERY IMPORTANT DEVELOPMENT RULE

Once implementation eventually begins:

DO NOT attempt to build everything in one giant pass.

Each milestone should have:

GOAL

IMPLEMENTATION TASKS

ACCEPTANCE CRITERIA

TESTS

MANUAL VERIFICATION

DEFINITION OF DONE

Do not move to the next milestone if the current milestone is fundamentally broken.

---

# 39. FIRST PROTOTYPE TEST CASE

Use this as the canonical initial test project:

SITE

Width:
20m

Depth:
30m

Orientation:
North = top
South = bottom

Entrance/front:
South

OFFSETS

Front/South:
6m

Rear/North:
2m

Left/West:
1.5m

Right/East:
1.5m

Therefore expected rectangular buildable envelope:

Width:
17m

Depth:
22m

Area:
374m²

ROOMS

3 Bedrooms

Bedroom minimum:
10m²
3m minimum width

1 Bathroom

Bathroom minimum:
5m²

1 Kitchen

Kitchen minimum:
12m²

1 Living Room

Living minimum:
20m²

1 Laundry

Laundry minimum:
5m²

1 Garage

2-car garage

GENERAL

Minimum hallway width:
1.0m

Grid:
0.25m

PREFERENCES

Kitchen near/adjacent to Living

Bathroom near Bedrooms

Bedrooms grouped

Bedrooms prefer exterior walls

Living prefers exterior wall

Garage toward South/front

Garage preferably away from Bedrooms

Wet areas preferably clustered

Minimize wasted space

Minimize excessive circulation

This test case should become a fixture used throughout development.

---

# 40. SUCCESS CRITERION

The first meaningful technical success is NOT:

"The website looks nice."

It is:

Given the canonical test project, PlanLab can reliably generate at least three valid, visually different conceptual rectangular-room layouts that:

* stay inside the buildable envelope
* contain all required rooms
* meet required minimum dimensions
* contain no room overlaps
* maintain valid circulation
* place the garage appropriately toward the south/front
* respect hard constraints
* score soft preferences
* provide understandable score explanations
* can be rendered correctly on an SVG grid

The polished interface comes after the mathematical/layout system is proven.

---

# 41. YOUR TASK RIGHT NOW

Again:

**DO NOT IMPLEMENT THE APPLICATION YET.**

Start by analyzing the product.

Then produce the planning documentation.

I want you to:

1. Restate the system in precise technical terms.
2. Identify ambiguities.
3. Identify dangerous assumptions.
4. Simplify anything unnecessarily complicated.
5. Define the MVP boundary.
6. Design the domain/data model.
7. Design the coordinate/grid system.
8. Design the site + offset/buildable-envelope model.
9. Design the geometry primitives.
10. Design the rule engine.
11. Design the validation system.
12. Design the circulation model.
13. Design adjacency calculations.
14. Compare candidate-generation approaches.
15. Choose an MVP generation strategy.
16. Design scoring.
17. Design layout diversity/deduplication.
18. Design explainability.
19. Design local persistence.
20. Design the UI architecture.
21. Design testing strategy.
22. Identify technical risks.
23. Produce the milestone implementation plan.
24. Produce open questions that genuinely require architect/user input.

When assumptions can reasonably be made for a prototype, make them and clearly document them instead of blocking progress.

However, highlight decisions that could fundamentally affect the layout engine and should therefore be confirmed before implementation.

Finish with a section called:

# RECOMMENDED NEXT ACTION

Tell me exactly what we should validate or decide before allowing Codex to begin Milestone 0.

Do not start Milestone 0 until I explicitly approve the plan.
