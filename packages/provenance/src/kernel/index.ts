// src/kernel — the pure provenance core, folded in from the standalone
// `obsidian-provenance` Python CLI and carried through two homes: the Governor
// host's `provenance` capability module, and now the `vault-provenance`
// satellite plugin. The code moved verbatim; only who mounts it changed.
//
// Every file here is Obsidian-free: the freshness / reconcile / regen engines
// run over an injected `ProvenanceSource` (provenance-source.ts), the same
// injected-seam pattern every satellite in this suite uses. The Obsidian-facing
// adapter is `../obsidian-source.ts`, the three published tool specs are
// `../tools.ts`, and the settings that feed them are `../settings.ts`. Nothing
// here imports `obsidian`, the MCP SDK, or `vault-mcp-api`.

export type {
  ProvenanceSource,
  ProvenanceWriter,
  ProvenanceBackend,
  FileStat,
} from "./provenance-source.js";
export { checkFreshness, type FreshnessVerdict } from "./freshness.js";
export { resolveSource, resolveEntries, latestMtime, isGlob, type ResolvedEntries } from "./sources.js";
export { reconcile, type Reconciliation, type PluginManifest } from "./plugins.js";
export { renderAudit, extractSections, reinsertSections } from "./render.js";
export { regenerateAudit, auditPath } from "./regen.js";
export {
  DEFAULT_NOTES_DIR,
  DEFAULT_NOTES_SOURCE,
  DEFAULT_AUDIT_NOTE,
  notesGlob,
  globMatchesPath,
  globSegmentRe,
  flatAuditPath,
  AUDIT_GENERATOR,
  GENERATOR_FIELD,
  AUDIT_DERIVATION_MODE,
  SOURCE_COUNT_FIELD,
  DEFAULT_PROVENANCE_CONFIG,
  auditDerivedFrom,
  provenanceConfigOf,
  validateProvenanceConfig,
  type ProvenanceConfig,
  type NotesSource,
} from "./provenance-config.js";
