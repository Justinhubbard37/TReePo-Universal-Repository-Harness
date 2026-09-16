export {
  evaluateAuthorization,
  loadAnchoredAuthz,
  requireAuthorization,
  type AuthorizationDecision,
  type AuthorizationNeed,
  type IneligibilityReason,
} from "./eligibility.ts";
export {
  assertAuthzRecordShape,
  AUTHZ_KIND,
  AUTHZ_SCHEMA_VERSION,
  authzRecordFile,
  buildAuthzRecord,
  readAuthzRecords,
  writeAuthzRecord,
  type AuthzRecord,
  type AuthzRecordBody,
  type AuthzScope,
  type NewAuthzRecord,
} from "./record.ts";
