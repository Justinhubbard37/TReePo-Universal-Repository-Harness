export { layoutFor, objectFile, TREEPO_DIR, type Layout } from "./layout.ts";
export {
  assertNextAction,
  assertStateObjectShape,
  assertSurfaceDigests,
  assertWorkingCopyFacts,
  STATE_KIND,
  STATE_SCHEMA_VERSION,
  type CoreContinuation,
  type NextAction,
  type Position,
  type RepoFacts,
  type StateObject,
  type SurfaceDigests,
  type TrackedItem,
  type Transition,
  type WorkingCopyFacts,
} from "./schema.ts";
export { decodeCurrent, encodeCurrent, type CurrentPointer } from "./current.ts";
export { computeSurfaceDigests, computeSurfaceDigestsWith, digestFileSet, surfaceDigestsEqual, type SurfaceDelta } from "./surface.ts";
export {
  decodeObject,
  identify,
  listObjects,
  OBJECT_FILE_NAME,
  readCurrent,
  readObject,
  writeCurrent,
  writeObject,
  type ObjectListing,
  type StoredObject,
  type WriteObjectResult,
} from "./store.ts";
export { buildGenesis, buildSuccessor, checkSuccession, type GenesisInput, type NewItem, type SuccessorInput } from "./successor.ts";
export {
  isGenesis,
  MECHANICAL_NOTE,
  requireValidState,
  validateAuthoritativeState,
  walkLineage,
  type ObjectReader,
  type ValidatedState,
  type ValidationFailure,
  type ValidationOk,
  type ValidationReport,
} from "./validate.ts";
