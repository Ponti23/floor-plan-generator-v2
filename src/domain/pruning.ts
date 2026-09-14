/**
 * An intentionally tiny, exhaustive packing oracle for search-pruning tests.
 *
 * The production generator uses analytical rectangle decomposition for speed.
 * This module uses an independent occupied-cell set instead: on a bounded grid
 * it enumerates every placement, then runs the same enumeration with only the
 * minimum-remaining-area cut enabled.  The two optima must agree.  A recorded
 * area-cut witness is therefore a proof that the discarded branch has no valid
 * completion, and consequently could not contain the selected optimum.
 *
 * It is deliberately not imported by generator.ts.  Keeping the oracle out of
 * the production path prevents a shared implementation bug from making the
 * pruning assertion tautological.
 */

export interface TinyGridVariant {
  id: string;
  width: number;
  depth: number;
  score: number;
}

export interface TinyGridRoom {
  id: string;
  /** Minimum occupied cell count needed by this room and all variants. */
  minimumArea: number;
  variants: readonly TinyGridVariant[];
}

export interface TinyGridProblem {
  footprint: { x: number; y: number; width: number; depth: number };
  rooms: readonly TinyGridRoom[];
}

export interface TinyGridPlacement {
  roomId: string;
  variantId: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  score: number;
}

export interface TinyGridSolution {
  placements: readonly TinyGridPlacement[];
  score: number;
  /** Stable path key used to resolve equal-score optima. */
  key: string;
}

export interface PrunedBranchCertificate {
  /** Chosen placements before the remaining-area cut fired. */
  path: readonly TinyGridPlacement[];
  availableArea: number;
  minimumRemainingArea: number;
  reason: "minimum-remaining-area";
  /** Stronger than a score comparison: no valid completion exists. */
  cannotContainSelectedOptimum: true;
}

export interface TinyGridPruningRun {
  solutions: readonly TinyGridSolution[];
  exploredBranches: number;
  prunedBranches: readonly PrunedBranchCertificate[];
}

export interface TinyGridPruningAudit {
  exhaustiveOptimum: TinyGridSolution | null;
  prunedOptimum: TinyGridSolution | null;
  /** Alias phrased for callers/reporting the selected optimum explicitly. */
  selectedOptimum: TinyGridSolution | null;
  exhaustiveSolutionCount: number;
  prunedSolutionCount: number;
  exhaustiveBranches: number;
  prunedBranches: readonly PrunedBranchCertificate[];
  /** True only when exhaustive and pruned runs choose the same optimum key. */
  equivalent: boolean;
}

interface ValidatedProblem {
  footprint: TinyGridProblem["footprint"];
  rooms: readonly TinyGridRoom[];
  footprintCells: readonly string[];
  footprintCellSet: ReadonlySet<string>;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function assertProblem(problem: TinyGridProblem): ValidatedProblem {
  if (problem === null || typeof problem !== "object") {
    throw new TypeError("tiny pruning problem must be an object");
  }
  const footprint = problem.footprint;
  if (footprint === null || typeof footprint !== "object") {
    throw new TypeError("tiny pruning footprint must be an object");
  }
  assertPositiveInteger(footprint.width, "footprint.width");
  assertPositiveInteger(footprint.depth, "footprint.depth");
  if (!Number.isSafeInteger(footprint.x) || !Number.isSafeInteger(footprint.y)) {
    throw new RangeError("footprint origin must be a safe integer");
  }
  if (!Array.isArray(problem.rooms) || problem.rooms.length === 0) {
    throw new RangeError("tiny pruning problem must contain at least one room");
  }
  const ids = new Set<string>();
  const rooms = problem.rooms.map((room, roomIndex) => {
    if (room === null || typeof room !== "object" || typeof room.id !== "string" || room.id.length === 0) {
      throw new TypeError(`room ${roomIndex} must have a non-empty id`);
    }
    if (ids.has(room.id)) throw new RangeError(`duplicate room id: ${room.id}`);
    ids.add(room.id);
    assertPositiveInteger(room.minimumArea, `rooms[${roomIndex}].minimumArea`);
    if (!Array.isArray(room.variants) || room.variants.length === 0) {
      throw new RangeError(`room ${room.id} must have at least one variant`);
    }
    const variantIds = new Set<string>();
    const variants = room.variants.map((variant: TinyGridVariant, variantIndex: number) => {
      if (variant === null || typeof variant !== "object" || typeof variant.id !== "string" || variant.id.length === 0) {
        throw new TypeError(`variant ${room.id}[${variantIndex}] must have a non-empty id`);
      }
      if (variantIds.has(variant.id)) throw new RangeError(`duplicate variant id: ${room.id}/${variant.id}`);
      variantIds.add(variant.id);
      assertPositiveInteger(variant.width, `variants[${room.id}/${variant.id}].width`);
      assertPositiveInteger(variant.depth, `variants[${room.id}/${variant.id}].depth`);
      if (!Number.isFinite(variant.score)) throw new RangeError(`variant ${room.id}/${variant.id} score must be finite`);
      if (variant.width * variant.depth < room.minimumArea) {
        throw new RangeError(`variant ${room.id}/${variant.id} is below room minimum area`);
      }
      return Object.freeze({ ...variant });
    });
    variants.sort((a: TinyGridVariant, b: TinyGridVariant) => a.id < b.id ? -1 : a.id > b.id ? 1 : a.width - b.width || a.depth - b.depth);
    return Object.freeze({ ...room, variants });
  });
  const footprintCells: string[] = [];
  for (let x = footprint.x; x < footprint.x + footprint.width; x += 1) {
    for (let y = footprint.y; y < footprint.y + footprint.depth; y += 1) {
      footprintCells.push(`${x},${y}`);
    }
  }
  return {
    footprint: Object.freeze({ ...footprint }),
    rooms: Object.freeze(rooms),
    footprintCells: Object.freeze(footprintCells),
    footprintCellSet: new Set(footprintCells),
  };
}

function cellsFor(x: number, y: number, width: number, depth: number): string[] {
  const cells: string[] = [];
  for (let cellX = x; cellX < x + width; cellX += 1) {
    for (let cellY = y; cellY < y + depth; cellY += 1) cells.push(`${cellX},${cellY}`);
  }
  return cells;
}

function placementFits(
  placement: TinyGridPlacement,
  problem: ValidatedProblem,
  occupied: ReadonlySet<string>,
): boolean {
  const cells = cellsFor(placement.x, placement.y, placement.width, placement.depth);
  return cells.every((cell) => problem.footprintCellSet.has(cell) && !occupied.has(cell));
}

function placementKey(placement: TinyGridPlacement): string {
  return `${placement.roomId}/${placement.variantId}@${placement.x},${placement.y},${placement.width},${placement.depth}`;
}

function solutionKey(placements: readonly TinyGridPlacement[]): string {
  return placements.map(placementKey).join("|");
}

function betterSolution(current: TinyGridSolution | null, candidate: TinyGridSolution): TinyGridSolution {
  if (current === null || candidate.score > current.score || candidate.score === current.score && candidate.key < current.key) {
    return candidate;
  }
  return current;
}

function runTinyGrid(
  validated: ValidatedProblem,
  useMinimumAreaPruning: boolean,
): TinyGridPruningRun {
  const solutions: TinyGridSolution[] = [];
  const certificates: PrunedBranchCertificate[] = [];
  let exploredBranches = 0;
  const minimumRemainingArea = (roomIndex: number): number => validated.rooms
    .slice(roomIndex)
    .reduce((total, room) => total + room.minimumArea, 0);

  function visit(
    roomIndex: number,
    occupied: Set<string>,
    placements: TinyGridPlacement[],
    score: number,
  ): void {
    exploredBranches += 1;
    if (roomIndex >= validated.rooms.length) {
      solutions.push({
        placements: Object.freeze(placements.map((placement) => Object.freeze({ ...placement }))),
        score,
        key: solutionKey(placements),
      });
      return;
    }
    if (useMinimumAreaPruning) {
      const availableArea = validated.footprintCells.length - occupied.size;
      const requiredArea = minimumRemainingArea(roomIndex);
      if (availableArea < requiredArea) {
        certificates.push({
          path: Object.freeze(placements.map((placement) => Object.freeze({ ...placement }))),
          availableArea,
          minimumRemainingArea: requiredArea,
          reason: "minimum-remaining-area",
          cannotContainSelectedOptimum: true,
        });
        return;
      }
    }
    const room = validated.rooms[roomIndex]!;
    for (const variant of room.variants) {
      for (let x = validated.footprint.x; x <= validated.footprint.x + validated.footprint.width - variant.width; x += 1) {
        for (let y = validated.footprint.y; y <= validated.footprint.y + validated.footprint.depth - variant.depth; y += 1) {
          const placement: TinyGridPlacement = {
            roomId: room.id,
            variantId: variant.id,
            x,
            y,
            width: variant.width,
            depth: variant.depth,
            score: variant.score,
          };
          if (!placementFits(placement, validated, occupied)) continue;
          const cells = cellsFor(x, y, variant.width, variant.depth);
          const nextOccupied = new Set(occupied);
          for (const cell of cells) nextOccupied.add(cell);
          placements.push(placement);
          visit(roomIndex + 1, nextOccupied, placements, score + variant.score);
          placements.pop();
        }
      }
    }
  }

  visit(0, new Set(), [], 0);
  return {
    solutions: Object.freeze(solutions),
    exploredBranches,
    prunedBranches: Object.freeze(certificates),
  };
}

/** Enumerate every valid solution on the tiny grid without any pruning. */
export function enumerateTinyGridSolutions(problem: TinyGridProblem): readonly TinyGridSolution[] {
  return runTinyGrid(assertProblem(problem), false).solutions;
}

/** Run the tiny-grid search with the minimum-area admissibility cut enabled. */
export function runTinyGridWithPruning(problem: TinyGridProblem): TinyGridPruningRun {
  return runTinyGrid(assertProblem(problem), true);
}

/**
 * Compare exhaustive and area-pruned search and return proof certificates for
 * every discarded branch.  `equivalent` is false if pruning changes the
 * selected optimum, so a future change cannot silently weaken this oracle.
 */
export function auditTinyGridPruning(problem: TinyGridProblem): TinyGridPruningAudit {
  const validated = assertProblem(problem);
  const exhaustive = runTinyGrid(validated, false);
  const pruned = runTinyGrid(validated, true);
  const choose = (solutions: readonly TinyGridSolution[]): TinyGridSolution | null => {
    let best: TinyGridSolution | null = null;
    for (const solution of solutions) best = betterSolution(best, solution);
    return best;
  };
  const exhaustiveOptimum = choose(exhaustive.solutions);
  const prunedOptimum = choose(pruned.solutions);
  return {
    exhaustiveOptimum,
    prunedOptimum,
    selectedOptimum: exhaustiveOptimum,
    exhaustiveSolutionCount: exhaustive.solutions.length,
    prunedSolutionCount: pruned.solutions.length,
    exhaustiveBranches: exhaustive.exploredBranches,
    prunedBranches: pruned.prunedBranches,
    equivalent: exhaustiveOptimum?.key === prunedOptimum?.key && exhaustiveOptimum?.score === prunedOptimum?.score,
  };
}

export const pruningOracle = auditTinyGridPruning;
