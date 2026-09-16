// Adapter Router (BLD-001A): interprets a plain-language objective against
// the declared intents of available adapters and proposes capabilities.
//
// The interpretation here is a deterministic keyword table (S6 choice; no
// external model call, ED-13). Whatever produced the text (a human or an AI
// agent), the result is a *recommendation*. It installs nothing, authorizes
// nothing, and activates nothing; those remain deterministic core decisions
// (Adapter Contract §5: "AI interprets. TReePo verifies. User authorizes").

import type { AdapterStatus } from "./api.ts";
import type { Registry } from "./registry.ts";

export interface RouteCandidate {
  readonly adapterId: string;
  readonly capability: string;
  readonly score: number;
  readonly matchedKeywords: readonly string[];
}

export interface RouteResult {
  readonly kind: "recommendation";
  readonly intent: string;
  readonly tokens: readonly string[];
  readonly candidates: readonly RouteCandidate[];
  /** Constant reminder carried in every result: selection is not authorization. */
  readonly authorization: "not-conferred-by-router";
  /** Distinct states of every available adapter at the time of routing, for the caller's information. */
  readonly statuses: readonly AdapterStatus[];
}

export function tokenize(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0))].sort();
}

export function route(intent: string, registry: Registry, statuses: readonly AdapterStatus[]): RouteResult {
  const tokens = tokenize(intent);
  const tokenSet = new Set(tokens);
  const candidates: RouteCandidate[] = [];
  for (const impl of registry.available) {
    for (const decl of impl.manifest.intents) {
      const matched = decl.keywords.filter((k) => tokenSet.has(k.toLowerCase())).sort();
      if (matched.length > 0) candidates.push({ adapterId: impl.manifest.id, capability: decl.capability, score: matched.length, matchedKeywords: matched });
    }
  }
  candidates.sort((a, b) => b.score - a.score || (a.adapterId < b.adapterId ? -1 : a.adapterId > b.adapterId ? 1 : 0) || (a.capability < b.capability ? -1 : 1));
  const recommendedIds = new Set(candidates.map((c) => c.adapterId));
  return {
    kind: "recommendation",
    intent,
    tokens,
    candidates,
    authorization: "not-conferred-by-router",
    statuses: statuses.map((s) => ({ ...s, recommended: recommendedIds.has(s.id) })),
  };
}
