# UI Architecture

## Workspace

Retain the reference mockup's professional three-pane structure:

```text
top toolbar
├─ left: brief editor (fixed/resizable, ~300–360 px)
├─ centre: SVG plan viewport (flex, dominant)
└─ right: options and analysis (fixed/resizable, ~320–400 px)
```

The canvas should receive roughly 65–70% of available visual attention on a typical desktop. Use restrained square/low-radius controls, dense typography, neutral surfaces, and clear line hierarchy. Do not imply construction-document detail through decorative furniture or realistic materials in MVP.

The supplied `PlanLab-Mockup.png` is directional, not a binding feature list. Its Export, undo/redo, landscaping, furniture, windows, and detailed door graphics exceed MVP and should be removed or visibly disabled in the first functional shell.

## State ownership

- A typed project reducer owns committed brief changes and dirty state.
- Local form state owns incomplete numeric text until commit.
- A generation controller owns request ID, status, progress, cancel/retry, and last compatible result.
- Result selection is UI state keyed by immutable layout ID.
- Viewport transform, toggles, hover, and focused evidence are ephemeral view state.
- Domain validation, layout facts, scorecards, and explanation selection are not recomputed in React.

No client state library is needed initially; reducer/context plus focused hooks is sufficient. Reassess only if profiling shows excessive propagation or editing workflows become complex.

## Left panel

Sections:

1. **Site** — width, depth, fixed north/south orientation.
2. **Offsets** — south/front, north/rear, west/left, east/right, source labels.
3. **Area policy** — target/max gross floor area or disclosed automatic policy.
4. **Program** — room rows, quantity, minima, preferred area, compact advanced section.
5. **Relationships** — a small structured editor for prefer/avoid/must relationships.
6. **Planning assumptions** — circulation width, pass-through policy summary, optional preference toggles.

Grid resolution is shown as “250 mm planning grid” informationally, not editable. Put the primary Generate action at the bottom and disable it only for actionable input errors. A changed brief marks old results as stale rather than silently presenting them as current.

## Centre SVG

Render layers in stable order:

1. background grid;
2. site boundary;
3. buildable envelope and offset dimensions;
4. building footprint;
5. room/circulation fills;
6. boundaries and abstract portals/entrance;
7. labels, areas, and optional dimensions;
8. evidence highlight overlay;
9. north indicator and scale.

SVG is appropriate because plans are vector, inspectable, accessible, and modest in element count. Use a grid-unit viewBox and a single viewport transform. Pan/zoom/fit affect only the view. A legend must distinguish lot, envelope, footprint, room, and circulation.

## Right panel

Show up to three strategy options with thumbnails and honest states:

- Compact Efficiency;
- Best Flow;
- Balanced.

Selection updates the main plan and shows raw area metrics, whole-number category scores, observations, and rule checks. Hard checks use PASS/WARNING/FAIL counts. Selecting an observation highlights referenced geometry. If fewer than three options exist, preserve empty slots with the reason rather than substituting duplicates.

## Generation states

- `idle`
- `invalidBrief`
- `generating` with phase, deterministic progress counters, elapsed watchdog, and Cancel
- `complete`
- `partial` (fewer than three or insufficient diversity)
- `infeasible`
- `budgetExceeded`
- `workerError`

Cancellation returns to the last valid result without discarding edits. Retry uses the same seed by default; “new variations” explicitly changes the seed.

## Persistence experience

Autosave committed project changes after a short debounce. Display `Saved locally`, `Saving`, or `Local save failed`. Reset Project is destructive and requires a confirmation that states local data will be removed. When migration/corruption recovery occurs, explain it and allow copying/downloading the recovery payload later; MVP may simply retain it under a separate local key.

## Accessibility and responsive boundary

Desktop-first does not mean mouse-only. All form and result controls need labels, visible focus, keyboard order, adequate contrast, and non-colour status indicators. SVG rooms need text alternatives through the analysis panel. At narrow widths, allow panels to collapse; a polished mobile editing experience is out of scope.

## Copy constraints requiring product approval

Strategy names, the conceptual-use disclaimer, metric names, and infeasibility language are product/copy hard gates under repository rules. The plan recommends language, but implementation should not freeze it without approval.

