# Milestone 1 normalized-fixture diagnostics

These artifacts are the Stage 1 bucket 1.3 inspection of the canonical brief
after normalization: what the solver actually receives, in millimetres and in
250 mm grid units, plus the discretization evidence for the conservative
snapping.

Regenerate them with `npm run diagnostics:canonical`, or verify without writing
with `node scripts/inspect-canonical.mjs --check`. `test/project-inspection.test.ts`
fails when either artifact drifts from the domain renderers.

| Artifact | Contents |
|---|---|
| [canonical-fixture.txt](canonical-fixture.txt) | Identity, fingerprint, discretization block, expanded program, relationships, planning settings |
| [discretization.txt](discretization.txt) | Authored site/envelope versus snapped grid rectangles, inset loss, discretization loss, findings |

Both files are pure functions of the normalized canonical project: no timestamps,
no locale formatting, no ambient state.
