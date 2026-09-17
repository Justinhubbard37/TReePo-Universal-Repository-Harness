// The authoritative transport path allowlist (ED-07, ED-14).
//
// Governing: BLD-004 (the complete durable state needed to identify, validate
// and resume continuity travels, including authority-bearing adapter state;
// session credentials, hydration capabilities, runtime locks, caches and
// semantic SQLite stay outside); Acceptance L.1, L.4, L.6.
//
// A path is relative to `.treepo/` with POSIX separators. Only these five
// kinds exist; everything else (in particular all of `runtime/**`) is refused
// on export and on import. The rules are identical on every platform, so a
// bundle never depends on one platform's path identity.

export type TransportFileKind = "owner" | "current" | "object" | "authz" | "adapter";

const OBJECT_PATH = /^state\/objects\/[0-9a-f]{64}\.json$/;
const AUTHZ_PATH = /^state\/authz\/[0-9a-f]{64}\.json$/;
const ADAPTER_PATH = /^adapters\/([A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9_-])?)\.json$/;
/** Device names Windows reserves regardless of extension; refused everywhere so the rules stay platform-neutral. */
const RESERVED_NAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i;

export function classifyTransportPath(path: string): TransportFileKind | null {
  if (path === "OWNER") return "owner";
  if (path === "state/CURRENT") return "current";
  if (OBJECT_PATH.test(path)) return "object";
  if (AUTHZ_PATH.test(path)) return "authz";
  const adapter = ADAPTER_PATH.exec(path);
  if (adapter !== null && !RESERVED_NAME.test(adapter[1]!)) return "adapter";
  return null;
}

/** TReePo scaffolding written from core constants on the receiving copy; never carried in a bundle. */
export const SCAFFOLD_PATHS: readonly string[] = [".gitignore", ".gitattributes"];

/** What deliberately does not travel, stated for reports and documentation. */
export const TRANSPORT_EXCLUDED: readonly string[] = [
  "runtime/** — writer lock, transaction journals, hydration/session capabilities, semantic memory.sqlite, caches (ephemeral; never authoritative)",
  "AGENT-ENTRY.md — derived orientation file; regenerated on the receiving copy",
  ".gitignore, .gitattributes — TReePo scaffolding; written from core constants on the receiving copy",
];

export const CLONE_NOTE =
  "A Git clone carries TReePo authoritative state only as of the last commit that contains every authoritative file under .treepo/ (OWNER, state/, adapters/); runtime state never travels. The export bundle is the defined complete transfer.";
