// Semantic-subsystem errors (Semantic Contract §9.10; Product Contract
// "Failure philosophy"): distinguishable from deterministic continuity
// failures by class and category. A semantic failure degrades retrieval
// only; it never means authoritative truth is in doubt.

import { TreepoError, type TreepoErrorInit } from "../core/errors.ts";

export class SemanticError extends TreepoError {
  constructor(init: TreepoErrorInit) {
    super("semantic", init);
    this.name = "SemanticError";
  }
}

export function isSemanticError(value: unknown): value is SemanticError {
  return value instanceof SemanticError;
}
