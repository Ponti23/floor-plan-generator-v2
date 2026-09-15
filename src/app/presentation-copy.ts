import type { MetricCategory } from "../domain/metrics.ts";

/** Replaceable presentation language. Domain messages remain semantic descriptors. */
export interface PlanLabPresentationCopy {
  productName: string;
  subtitle: string;
  toolbar: {
    newProject: string;
    saveStatus: string;
    grid: string;
    measurements: string;
    settings: string;
  };
  sections: {
    site: string;
    offsets: string;
    areaPolicy: string;
    rooms: string;
    relationships: string;
    planningAssumptions: string;
  };
  actions: {
    generate: string;
    cancel: string;
    retry: string;
    discardDraft: string;
  };
  /**
   * Non-domain UI language lives here as well, so a copy/localisation pass
   * does not need to edit the rendering functions.
   */
  ui: {
    briefEyebrow: string;
    briefTitle: string;
    versionPrefix: string;
    projectName: string;
    width: string;
    depth: string;
    frontEntrance: string;
    frontSide: string;
    planningGrid: string;
    variationSeed: string;
    offsetLabels: Record<string, string>;
    offsetSourceLabels: Record<string, string>;
    targetGfa: string;
    maximumGfa: string;
    maxUnallocated: string;
    roomMinimumArea: string;
    roomPreferredArea: string;
    roomMinimumShortSide: string;
    roomMinimumWidth: string;
    roomMinimumDepth: string;
    roomMaxAspectRatio: string;
    roomExteriorPreference: string;
    roomPassThrough: string;
    roomNameAria: string;
    roomQuantityAriaSuffix: string;
    relationshipEmpty: string;
    chooseRoom: string;
    relationshipKindLabels: Record<string, string>;
    aggregationLabels: Record<string, string>;
    relationshipFromAriaPrefix: string;
    relationshipKindAriaPrefix: string;
    relationshipToAriaPrefix: string;
    relationshipAggregationAriaPrefix: string;
    relationshipStrengthAriaPrefix: string;
    relationshipStrengthPlaceholder: string;
    circulationWidth: string;
    passThroughPolicy: string;
    passThroughValue: string;
    gridResolution: string;
    planningHelper: string;
    selectTool: string;
    panTool: string;
    zoomOut: string;
    zoomIn: string;
    fitPlan: string;
    northOrientation: string;
    generatedPlanAria: string;
    stalePlanAria: string;
    viewportAria: string;
    viewportToolsAria: string;
    legendAria: string;
    northSymbol: string;
    zoomValue: string;
    scaleUnit: string;
    canvasReady: string;
    propertyBoundary: string;
    buildingFootprint: string;
    roomLegend: string;
    circulationLegend: string;
    entranceLabel: string;
    compareEyebrow: string;
    optionsTitle: string;
    analysisTitle: string;
    analysisFallbackTitle: string;
    optionPrefix: string;
    scoreBreakdown: string;
    observations: string;
    noEvidence: string;
    units: {
      metre: string;
      millimetre: string;
      squareMetre: string;
      percent: string;
      ratio: string;
    };
  };
  strategyNames: Record<string, string>;
  metricLabels: Record<MetricCategory, string>;
  status: {
    invalidBriefLabel: string;
    staleLabel: string;
    draftLabel: string;
    readyLabel: string;
    generatingLabel: string;
    completeLabel: string;
    partialLabel: string;
    infeasibleLabel: string;
    budgetExceededLabel: string;
    workerErrorLabel: string;
    staleResults: string;
    draftChanges: string;
    committed: string;
    invalidBrief: string;
    noResult: string;
    preparing: string;
    complete: string;
    partial: string;
    infeasible: string;
    budgetExceeded: string;
    workerError: string;
    commitPrompt: string;
    draftPrompt: string;
    progressExpansions: string;
    progressValid: string;
    conceptualUseNotice: string;
  };
}

/**
 * Recommended copy pending the Milestone 5.0 product hard gate. Keep this
 * object replaceable so copy approval/localisation does not touch rendering.
 */
export const RECOMMENDED_PRESENTATION_COPY: Readonly<PlanLabPresentationCopy> = Object.freeze({
  productName: "PlanLab",
  subtitle: "Concept Layout Generator",
  toolbar: {
    newProject: "New",
    saveStatus: "Saved locally",
    grid: "Grid",
    measurements: "Measurements",
    settings: "Settings",
  },
  sections: {
    site: "Site",
    offsets: "Offsets",
    areaPolicy: "Area policy",
    rooms: "Rooms",
    relationships: "Relationships",
    planningAssumptions: "Planning assumptions",
  },
  actions: {
    generate: "Generate layouts",
    cancel: "Cancel",
    retry: "Retry",
    discardDraft: "Discard edits",
  },
  ui: {
    briefEyebrow: "Project brief",
    briefTitle: "Brief",
    versionPrefix: "v",
    projectName: "Project name",
    width: "Width",
    depth: "Depth",
    frontEntrance: "Front / entrance",
    frontSide: "South / bottom",
    planningGrid: "Planning grid",
    variationSeed: "Variation seed",
    offsetLabels: {
      north: "North / rear",
      east: "East / right",
      south: "South / front",
      west: "West / left",
    },
    offsetSourceLabels: {
      architect: "architect",
      planning: "planning",
      system: "system",
      custom: "custom",
    },
    targetGfa: "Target GFA",
    maximumGfa: "Maximum GFA",
    maxUnallocated: "Max unallocated",
    roomMinimumArea: "Minimum area",
    roomPreferredArea: "Preferred area",
    roomMinimumShortSide: "Minimum short side",
    roomMinimumWidth: "Minimum width",
    roomMinimumDepth: "Minimum depth",
    roomMaxAspectRatio: "Max aspect ratio",
    roomExteriorPreference: "Prefer an exterior wall",
    roomPassThrough: "May be pass-through",
    roomNameAria: "Room name",
    roomQuantityAriaSuffix: " quantity",
    relationshipEmpty: "No relationship preferences in this brief.",
    chooseRoom: "Choose room…",
    relationshipKindLabels: {
      mustShareWall: "must share wall",
      preferShareWall: "prefer wall",
      preferNear: "prefer near",
      avoidShareWall: "avoid wall",
      keepSeparate: "keep separate",
    },
    aggregationLabels: {
      any: "any",
      all: "all",
      nearest: "nearest",
      average: "average",
    },
    relationshipFromAriaPrefix: "Relationship",
    relationshipKindAriaPrefix: "Relationship",
    relationshipToAriaPrefix: "Relationship",
    relationshipAggregationAriaPrefix: "Relationship",
    relationshipStrengthAriaPrefix: "Relationship",
    relationshipStrengthPlaceholder: "strength",
    circulationWidth: "Minimum hallway width",
    passThroughPolicy: "Pass-through policy",
    passThroughValue: "Declared room traits",
    gridResolution: "Grid resolution",
    planningHelper: "Only the brief's room traits may enable pass-through. Grid resolution is fixed for reproducible planning.",
    selectTool: "Select tool",
    panTool: "Pan tool",
    zoomOut: "Zoom out",
    zoomIn: "Zoom in",
    fitPlan: "Fit plan",
    northOrientation: "North orientation",
    generatedPlanAria: "Generated floor plan",
    stalePlanAria: "Earlier generated floor plan; regenerate for the current brief",
    viewportAria: "Plan viewport",
    viewportToolsAria: "Viewport controls",
    legendAria: "Plan legend",
    northSymbol: "N",
    zoomValue: "100%",
    scaleUnit: "mm",
    canvasReady: "Ready",
    propertyBoundary: "Property boundary",
    buildingFootprint: "Building footprint",
    roomLegend: "Room",
    circulationLegend: "Circulation",
    entranceLabel: "ENTRANCE (SOUTH)",
    compareEyebrow: "Compare alternatives",
    optionsTitle: "Layout options",
    analysisTitle: "Analysis",
    analysisFallbackTitle: "Analysis",
    optionPrefix: "Option",
    scoreBreakdown: "Score breakdown",
    observations: "Observations",
    noEvidence: "No evidence available yet.",
    units: {
      metre: "m",
      millimetre: "mm",
      squareMetre: "m²",
      percent: "%",
      ratio: ":1",
    },
  },
  strategyNames: {
    compactEfficiency: "Compact Efficiency",
    bestFlow: "Best Flow",
    balanced: "Balanced",
  },
  metricLabels: {
    programSpace: "Space utilization",
    flow: "Flow",
    relationships: "Adjacency",
    liveability: "Room proportions",
    servicesSite: "Services & site",
  },
  status: {
    invalidBriefLabel: "Invalid brief",
    staleLabel: "Results need regeneration",
    draftLabel: "Uncommitted edits",
    readyLabel: "Ready",
    generatingLabel: "Generating",
    completeLabel: "Complete",
    partialLabel: "Partial result",
    infeasibleLabel: "Infeasible brief",
    budgetExceededLabel: "Search budget reached",
    workerErrorLabel: "Worker unavailable",
    staleResults: "Results are from an earlier brief",
    draftChanges: "Uncommitted edits",
    committed: "Brief committed",
    invalidBrief: "Resolve the highlighted brief issues before generating.",
    noResult: "Generate a layout to inspect options.",
    preparing: "Preparing generation…",
    complete: "Three compatible layout options ready.",
    partial: "Fewer than three distinct options were found.",
    infeasible: "No valid layout was found for this brief.",
    budgetExceeded: "The search budget was reached before completion.",
    workerError: "The generation worker stopped unexpectedly.",
    commitPrompt: "Commit a brief and generate when ready.",
    draftPrompt: "Uncommitted edits — commit to regenerate.",
    progressExpansions: "expansions",
    progressValid: "valid",
    conceptualUseNotice: "Conceptual layout only — verify dimensions, regulations, and construction requirements before use.",
  },
});

export interface PresentationCopyOverrides {
  productName?: string;
  subtitle?: string;
  toolbar?: Partial<PlanLabPresentationCopy["toolbar"]>;
  sections?: Partial<PlanLabPresentationCopy["sections"]>;
  actions?: Partial<PlanLabPresentationCopy["actions"]>;
  ui?: Omit<Partial<PlanLabPresentationCopy["ui"]>, "offsetLabels" | "relationshipKindLabels" | "aggregationLabels" | "units"> & {
    offsetLabels?: Record<string, string>;
    relationshipKindLabels?: Record<string, string>;
    aggregationLabels?: Record<string, string>;
    units?: Partial<PlanLabPresentationCopy["ui"]["units"]>;
  };
  strategyNames?: Record<string, string>;
  metricLabels?: Partial<Record<MetricCategory, string>>;
  status?: Partial<PlanLabPresentationCopy["status"]>;
}

/** Resolve recommended copy with shallow per-group overrides for future approval/locales. */
export function resolvePresentationCopy(
  overrides: PresentationCopyOverrides = {},
): PlanLabPresentationCopy {
  return {
    ...RECOMMENDED_PRESENTATION_COPY,
    ...(overrides.productName === undefined ? {} : { productName: overrides.productName }),
    ...(overrides.subtitle === undefined ? {} : { subtitle: overrides.subtitle }),
    toolbar: { ...RECOMMENDED_PRESENTATION_COPY.toolbar, ...overrides.toolbar },
    sections: { ...RECOMMENDED_PRESENTATION_COPY.sections, ...overrides.sections },
    actions: { ...RECOMMENDED_PRESENTATION_COPY.actions, ...overrides.actions },
    ui: {
      ...RECOMMENDED_PRESENTATION_COPY.ui,
      ...overrides.ui,
      offsetLabels: { ...RECOMMENDED_PRESENTATION_COPY.ui.offsetLabels, ...overrides.ui?.offsetLabels },
      offsetSourceLabels: { ...RECOMMENDED_PRESENTATION_COPY.ui.offsetSourceLabels, ...overrides.ui?.offsetSourceLabels },
      relationshipKindLabels: { ...RECOMMENDED_PRESENTATION_COPY.ui.relationshipKindLabels, ...overrides.ui?.relationshipKindLabels },
      aggregationLabels: { ...RECOMMENDED_PRESENTATION_COPY.ui.aggregationLabels, ...overrides.ui?.aggregationLabels },
      units: { ...RECOMMENDED_PRESENTATION_COPY.ui.units, ...overrides.ui?.units },
    },
    strategyNames: { ...RECOMMENDED_PRESENTATION_COPY.strategyNames, ...overrides.strategyNames },
    metricLabels: { ...RECOMMENDED_PRESENTATION_COPY.metricLabels, ...overrides.metricLabels },
    status: { ...RECOMMENDED_PRESENTATION_COPY.status, ...overrides.status },
  };
}
