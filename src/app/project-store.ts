/**
 * Local project storage (Milestone 6).
 *
 * The app has no backend, so the single local project lives in the browser's
 * own storage.  This module owns the parts of that which are easy to get wrong:
 * namespaced keys, a stored schema/engine version, runtime validation of
 * whatever comes back (a stored value is untrusted input, exactly like a worker
 * message), and typed outcomes instead of exceptions.
 *
 * The storage itself is injected, so tests never touch a real browser store and
 * a denied/quota-exceeded store becomes a value the UI can render rather than a
 * thrown error that takes the workspace down.
 */

import type { ProjectBrief } from "../domain/model.ts";
import { tryNormalizeProject } from "../domain/normalization.ts";

/** Every key this app owns starts with this prefix. Nothing else is ever touched. */
export const PROJECT_STORE_NAMESPACE = "planlab";
export const PROJECT_STORE_PREFIX = `${PROJECT_STORE_NAMESPACE}:v1:`;
export const PROJECT_STORE_KEY = `${PROJECT_STORE_PREFIX}project`;
/** Stored generation result for the saved brief (bucket 6.5). */
export const RESULT_STORE_KEY = `${PROJECT_STORE_PREFIX}result`;
export const RECOVERY_KEY_PREFIX = `${PROJECT_STORE_PREFIX}recovery:`;

/** Version of the *stored document* shape, independent of the brief schema. */
export const PROJECT_STORE_VERSION = 1;

/** The minimal storage surface this module needs (`window.localStorage` fits). */
export interface StoragePort {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StoredProjectDocument {
  storeVersion: number;
  /** ISO timestamp of the write, for "saved locally" copy and diagnostics. */
  savedAt: string;
  project: ProjectBrief;
}

export type ProjectReadOutcome =
  | { status: "empty" }
  | { status: "loaded"; document: StoredProjectDocument }
  /**
   * A document written by an older storage version.  The raw value is left in
   * place; migrations (bucket 6.2) are the only thing allowed to rewrite it.
   */
  | { status: "outdated"; foundVersion: number }
  /** A document from a newer build. Never guessed at, never overwritten. */
  | { status: "unsupportedVersion"; foundVersion: number }
  /** Unparseable or semantically invalid; the raw value is preserved. */
  | { status: "corrupt"; reason: string }
  /** Storage itself refused to answer (denied, disabled, security error). */
  | { status: "unavailable"; reason: string };

export type ProjectWriteOutcome =
  | { status: "saved"; savedAt: string }
  | { status: "failed"; reason: string };

/**
 * What the workspace should tell the user about the last read.
 *
 * `null` means "nothing worth saying": an empty store is the normal first run.
 */
export type StorageNoticeKind =
  | "recovered"
  | "newerVersion"
  | "olderVersion"
  | "unavailable"
  /** A reset that could not remove everything it owns. */
  | "resetIncomplete";

export function storageNoticeKind(outcome: ProjectReadOutcome): StorageNoticeKind | null {
  switch (outcome.status) {
    case "corrupt":
      return "recovered";
    case "unsupportedVersion":
      return "newerVersion";
    case "outdated":
      return "olderVersion";
    case "unavailable":
      return "unavailable";
    default:
      return null;
  }
}

export interface ProjectStore {
  /** Key the current document is written to. */
  readonly key: string;
  read(): ProjectReadOutcome;
  write(project: ProjectBrief, savedAt?: string): ProjectWriteOutcome;
  /**
   * Bring an older stored document up to the supported version, one version at
   * a time. A document is only rewritten once every step has succeeded, so a
   * failed migration leaves the original bytes exactly where they were.
   */
  migrate(): MigrationOutcome;
  /** Remove only this app's keys; returns the keys that were removed. */
  clear(): string[];
  /** Every key this app owns, including recovery copies. */
  ownedKeys(): string[];
}

export interface StoreMigration {
  from: number;
  to: number;
  /** Return the migrated document, or null when this value cannot be migrated. */
  migrate(document: Record<string, unknown>): Record<string, unknown> | null;
}

export type MigrationOutcome =
  | { status: "notNeeded" }
  | { status: "migrated"; fromVersion: number; toVersion: number }
  | { status: "failed"; reason: string };

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function issueSummary(issues: readonly { path?: string; message: string }[]): string {
  return issues
    .slice(0, 3)
    .map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message))
    .join(" · ");
}

/**
 * Read the stored document once and classify it.
 *
 * A value that cannot be trusted is never silently replaced: the raw text stays
 * where it is so a later recovery step (bucket 6.2) or a human can still see it.
 */
function parseDocument(raw: string, supportedVersion: number): ProjectReadOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { status: "corrupt", reason: `stored project is not valid JSON (${describeError(error)})` };
  }
  if (!isRecord(parsed)) {
    return { status: "corrupt", reason: "stored project must be a JSON object" };
  }
  const version = parsed.storeVersion;
  // Version 0 was never written by a release, so it is corrupt rather than an
  // older format a migration could recognise.
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { status: "corrupt", reason: "stored project has no usable storeVersion" };
  }
  if (version > supportedVersion) return { status: "unsupportedVersion", foundVersion: version };
  if (version < supportedVersion) return { status: "outdated", foundVersion: version };

  // Version matches, so the payload still has to survive the same runtime
  // validation a worker message does.
  const normalized = tryNormalizeProject(parsed.project);
  if (!normalized.ok) {
    return {
      status: "corrupt",
      reason: `stored project failed validation (${issueSummary(normalized.issues)})`,
    };
  }
  const savedAt = typeof parsed.savedAt === "string" ? parsed.savedAt : new Date(0).toISOString();
  return {
    status: "loaded",
    document: {
      storeVersion: version,
      savedAt,
      project: parsed.project as ProjectBrief,
    },
  };
}

export function createProjectStore(
  storage: StoragePort,
  options: {
    prefix?: string;
    storeVersion?: number;
    key?: string;
    migrations?: readonly StoreMigration[];
  } = {},
): ProjectStore {
  const prefix = options.prefix ?? PROJECT_STORE_PREFIX;
  // The supported version is injectable so the migration seam (bucket 6.2) can
  // be tested when it lands, and so a reader can be pointed at a future version
  // deliberately rather than by editing this module.
  const supportedVersion = options.storeVersion ?? PROJECT_STORE_VERSION;
  const migrations = options.migrations ?? [];
  // A second store instance can share this namespace with its own key (the
  // stored result document uses `planlab:v1:result`), so `clear()` still removes
  // everything the app owns.
  const key = options.key ?? `${prefix}project`;

  const ownedKeys = (): string[] => {
    const keys: string[] = [];
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const candidate = storage.key(index);
        if (typeof candidate === "string" && candidate.startsWith(prefix)) keys.push(candidate);
      }
    } catch {
      // A store that cannot enumerate is treated as owning nothing rather than
      // as permission to delete keys it cannot see.
      return [];
    }
    return keys.sort();
  };

  return {
    key,
    ownedKeys,
    read(): ProjectReadOutcome {
      let raw: string | null;
      try {
        raw = storage.getItem(key);
      } catch (error) {
        return { status: "unavailable", reason: describeError(error) };
      }
      if (raw === null) return { status: "empty" };
      return parseDocument(raw, supportedVersion);
    },
    write(project: ProjectBrief, savedAt = new Date().toISOString()): ProjectWriteOutcome {
      const document: StoredProjectDocument = {
        storeVersion: PROJECT_STORE_VERSION,
        savedAt,
        project,
      };
      try {
        storage.setItem(key, JSON.stringify(document));
      } catch (error) {
        return { status: "failed", reason: describeError(error) };
      }
      return { status: "saved", savedAt };
    },
    migrate(): MigrationOutcome {
      let raw: string | null;
      try {
        raw = storage.getItem(key);
      } catch (error) {
        return { status: "failed", reason: describeError(error) };
      }
      if (raw === null) return { status: "notNeeded" };
      let current: Record<string, unknown>;
      try {
        const parsed = JSON.parse(raw);
        if (!isRecord(parsed)) return { status: "failed", reason: "stored project must be a JSON object" };
        current = parsed;
      } catch (error) {
        return { status: "failed", reason: `stored project is not valid JSON (${describeError(error)})` };
      }
      const fromVersion = typeof current.storeVersion === "number" ? current.storeVersion : 0;
      if (fromVersion === supportedVersion) return { status: "notNeeded" };
      if (fromVersion > supportedVersion) {
        return { status: "failed", reason: `stored project is from a newer store version (${fromVersion})` };
      }

      let version = fromVersion;
      let document = current;
      while (version < supportedVersion) {
        const step = migrations.find((candidate) => candidate.from === version);
        if (!step || step.to <= version) {
          return { status: "failed", reason: `no migration from store version ${version}` };
        }
        let migrated: Record<string, unknown> | null;
        try {
          migrated = step.migrate(document);
        } catch (error) {
          return { status: "failed", reason: `migration ${version} → ${step.to} threw (${describeError(error)})` };
        }
        if (!migrated || !isRecord(migrated)) {
          return { status: "failed", reason: `migration ${version} → ${step.to} produced no document` };
        }
        document = { ...migrated, storeVersion: step.to };
        version = step.to;
      }

      // A migration is only successful if the resulting document would be
      // loadable by this reader. Without this check a faulty registered step
      // could write a value that the next boot classifies as corrupt.
      const validated = parseDocument(JSON.stringify(document), supportedVersion);
      if (validated.status !== "loaded") {
        return { status: "failed", reason: `migrated project failed validation (${validated.status})` };
      }

      try {
        storage.setItem(key, JSON.stringify(document));
      } catch (error) {
        return { status: "failed", reason: describeError(error) };
      }
      return { status: "migrated", fromVersion, toVersion: version };
    },
    clear(): string[] {
      const removed: string[] = [];
      for (const owned of ownedKeys()) {
        try {
          storage.removeItem(owned);
          removed.push(owned);
        } catch {
          // Report what actually went; a partial reset must not claim success.
        }
      }
      return removed;
    },
  };
}

/**
 * A recovery key for a document that could not be read or migrated.
 * Timestamped so repeated failures never overwrite each other.
 */
export function recoveryKeyFor(timestamp: string, prefix = RECOVERY_KEY_PREFIX): string {
  return `${prefix}${timestamp.replace(/[:.]/g, "-")}`;
}

/**
 * Move an unreadable document aside instead of deleting it.
 * Returns the key it was preserved under, or null when storage refused.
 */
export function preserveUnreadableDocument(
  storage: StoragePort,
  store: ProjectStore,
  timestamp = new Date().toISOString(),
): string | null {
  let raw: string | null;
  try {
    raw = storage.getItem(store.key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const target = recoveryKeyFor(timestamp);
  try {
    storage.setItem(target, raw);
    storage.removeItem(store.key);
  } catch {
    return null;
  }
  return target;
}
