# PlanLab frontend mockup fidelity brief

## Authority and intent

The user explicitly selected [`../PlanLab-Mockup.png`](../PlanLab-Mockup.png) as the visual
reference for the frontend on 2026-09-15. Recreate its desktop visual hierarchy closely; do not
merely preserve the current three-column arrangement. This brief prepares implementation only and
does not itself authorize code changes or close the remaining 5.0 copy/shell hard gate.

Use these sources in this order:

1. `PlanLab-Mockup.png` controls visual composition, density, proportions, colour mood, and plan
   presentation.
2. `UI_ARCHITECTURE.md` controls state ownership, functional states, accessibility, and which
   mockup features are outside MVP.
3. Domain and worker APIs control data truth. Never manufacture a metric, observation, room,
   opening, or dimension merely to imitate the picture.

When the picture contains an out-of-scope feature (undo/redo, Export, decorative furniture,
landscaping, windows, or detailed door swings), omit it or render a clearly disabled shell control.
Do not build fake functionality. Preserve all existing generate, cancel, retry, stale-response,
worker-recovery, and deterministic-selection behavior.

## Reference frame

The reference is 1536 × 1024 pixels. At that viewport its major geometry is approximately:

- top toolbar: 56 px tall, white, full width, with a subtle bottom divider;
- left editor: 310 px wide;
- centre workspace: 840 px wide and visually dominant;
- right options/analysis panel: 385 px wide;
- vertical separators: 1 px cool grey;
- content below the toolbar fills the remaining height; left and right panes scroll independently,
  while the plan viewport remains stable.

At 1536 × 1024 the implementation should reproduce those proportions within about 8 px. Below the
desktop breakpoint, panels may collapse according to `UI_ARCHITECTURE.md`; do not shrink the plan
into an unusable sliver. Desktop fidelity is the acceptance target, not a polished mobile editor.

## Visual language

- Overall character: restrained professional CAD/planning application, not a marketing dashboard.
- Typography: Inter or the existing system sans fallback; dense 12–14 px body text, approximately
  18–20 px wordmark, 14–16 px section titles, semibold rather than oversized headings.
- Surfaces: near-white toolbar and side panels (`#f8f8fa` to `#ffffff`); centre canvas near white;
  cool-grey borders around `#e1e5e8`; primary text near `#17202b`; secondary text near `#596575`.
- Primary action and selected controls: clear saturated blue around `#1473e6`; do not reuse the
  current dark-green application header or green Generate button.
- Positive/status accent: green around `#3aa166`; warning accent: amber; informational notice:
  pale blue around `#e3effd`.
- Controls: compact, mostly square or 4–6 px radius, 32–38 px tall, white fill, quiet border, strong
  blue focus-visible treatment. Avoid pill controls, heavy shadows, large cards, and excessive
  whitespace.
- Room fills should echo the reference's low-saturation category palette: bedrooms pale blue,
  wet/service rooms blue-grey, living/dining warm cream, kitchen pale peach, entry/circulation
  off-white, and garage neutral grey. Colour must remain supportive; labels and boundaries carry
  meaning without colour.

## Required desktop composition

### Toolbar

Match the reference's white application bar. Left cluster: compact mark, `PlanLab`, and the lighter
subtitle `Concept Layout Generator`. Middle cluster: New and save status; existing functionality
may be wired here when available. Right cluster: view toggles and settings; out-of-scope actions
must be absent or visibly disabled. Keep toolbar groups separated by fine vertical rules and leave
the centre flexible rather than centring all controls.

Do not retain the current dark strip with a raw worker-state word as the primary visual identity.
Generation state belongs in the workspace as readable status/progress, not as a permanent debug
badge.

### Left brief editor

Use the mockup's compact stacked sections with uppercase micro-headings and horizontal separators:
Site, Rooms, and Constraints/Planning Assumptions. Inputs should align in columns with units in a
separate trailing cell. Room rows need a category swatch, label, quantity, compact summary, and
expand affordance. The expanded row should resemble the Kitchen example: indented fields,
checkboxes, relationship selects, and priority. The Generate action remains full-width and pinned
near the bottom of the usable pane.

The eventual functional fields remain those in `UI_ARCHITECTURE.md`: site, offsets, area policy,
program, relationships, and planning assumptions. The 250 mm grid is informational, never an
editable resolution. Do not invent mutable values just because the mockup shows them.

### Centre plan viewport

This is the dominant surface. Match the mockup's fine cool-grey square grid, generous white working
area, dashed property/site boundary, pale buildable/site tint, and high-contrast dark footprint and
room boundaries. Put pointer/pan controls at the upper left, zoom/percentage/Fit beside them, and a
north indicator at the upper right. Put the legend at lower left, entrance orientation below the
plan, and a simple metric scale at lower right when the necessary data exists.

Render only authoritative layout geometry. Improve the present bare rectangle view with:

- stable layer order from `UI_ARCHITECTURE.md`;
- room-specific muted fills;
- dark exterior walls and slightly lighter internal boundaries;
- centred room name plus formatted area on a second line;
- abstract portals/entrance where the payload provides them;
- actual footprint/site dimensions when derivable from geometry;
- selected evidence overlay above the plan, never baked into geometry.

Do not add furniture, trees, planting, cars, appliances, windows, or realistic door swings unless a
future scoped feature supplies authoritative data. Visual fidelity comes from hierarchy, line
weights, spacing, colour, labels, and controls—not decorative fabrication.

### Right options and analysis

Begin with `Layout Options` and a single horizontal row of up to three equal cards. Each card needs
an A/B/C badge, approved strategy name, whole-number score, and a real thumbnail derived from that
layout. The selected card uses a blue outline; empty/partial slots remain visible with an honest
reason and never duplicate another plan.

Below the cards, show the selected option heading and score, then compact key-value metrics separated
by hairlines. Follow with `Score Breakdown`: one row per approved category, a green horizontal bar,
and a whole-number value. Follow with `Observations`: icon plus concise text, using check/warning
semantics and allowing evidence-backed rows to highlight geometry. Anchor the conceptual-use notice
as a pale-blue block near the bottom when space permits.

`Max Area` in the image is not approved final copy; current product documents recommend `Compact
Efficiency`, `Best Flow`, and `Balanced`. Keep all strategy names, metric labels, disclaimer text,
and failure wording in one replaceable presentation-copy object until the user closes 5.0.

## Current-shell gaps Flash must explicitly close

The starter CSS now establishes the reference proportions, white/blue visual language, canvas grid,
compact density and option-card row. `src/app/main.ts` is still the original functional worker
vertical slice, so a faithful continuation must address these visible gaps without discarding the
verified CSS foundation:

- expand the white header into the reference toolbar with grouped semantic controls;
- preserve the new 310 / flexible / 385 px desktop pane proportions and add independent pane
  scrolling where needed;
- replace the sparse Brief form with dense, aligned editor sections and unit-aware rows;
- replace the grey canvas and basic SVG with the reference grid, site/envelope hierarchy, plan
  labels, line weights, viewport controls, orientation, legend, and scale;
- replace the right-side vertical buttons with three thumbnail cards across the top;
- add the selected option summary, raw metrics, score bars, observations, rule status, and notice;
- use the reference blue accent and neutral palette instead of the current green theme;
- retain accessible labels, focus-visible states, keyboard order, and non-colour status meaning.

## Implementation boundaries

- Continue with the current framework only after the user closes the Vite-vs-Next.js part of 5.0.
- Prefer semantic HTML, native SVG, and CSS; do not add a component library or icon package solely
  to copy the screenshot. Small inline SVG icons are sufficient.
- Keep rendering and presentation projections outside the domain. Do not modify solver semantics,
  scoring, canonical serialization, or worker protocol for a visual recreation.
- Split the current monolithic render function into focused presentation functions/modules when
  implementation begins, but avoid a framework migration disguised as styling work.
- Preserve loading, cancellation, error, partial, infeasible, budget-exceeded, and stale-result
  states even when the reference only shows the successful state.

## Screenshot-driven acceptance

Implementation is not complete after one CSS pass. Flash must iterate visually:

1. Run the app with the canonical fixture and a completed three-option result.
2. Capture the app at exactly 1536 × 1024.
3. Compare it side by side with `knowledge/PlanLab-Mockup.png`.
4. Correct pane geometry, toolbar height, information density, alignment, typography, colour,
   option-card composition, and plan framing before polishing minor details.
5. Repeat until the overall silhouette and hierarchy are immediately recognizable as the supplied
   mockup. Functional equivalence alone is a failure.
6. Also verify keyboard navigation, focus visibility, 1280 × 800 behavior, generation/cancel/edit,
   and the honest partial/error states.

Minimum visual pass criteria at 1536 × 1024:

- toolbar and all three pane boundaries align with the reference proportions;
- the plan is centred, dominant, and framed at a comparable scale;
- the left pane has comparable density and aligned form rows;
- three option cards appear in one row and the analysis hierarchy matches the reference;
- primary blue, neutral surfaces, muted room palette, border hierarchy, and compact type are visibly
  consistent with the reference;
- no horizontal page scrollbar, clipped primary action, overlapping controls, or unreadable labels;
- no fabricated architectural facts and no regression to worker/domain behavior.

Before committing, run `npm test`, `npm run typecheck`, `npm run build`, canonical diagnostics, and
the relevant browser flows. Record the screenshot viewport and the visual comparison result in the
Milestone 5 review evidence.
