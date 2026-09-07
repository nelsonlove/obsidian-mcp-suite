// settings.ts — this satellite's persisted settings, which are EMPTY, and the
// checked reason why.
//
// ── There was nothing to adopt, and that is a finding, not an oversight ─────
//
// Every satellite before this one carried a one-shot adoption of the host's
// `modules.<id>.config` block: skills, triage, cross-session and bases each had
// keys a user could have set, and losing them silently would have been a
// regression. **The jd-scaffold module declared NO `config` block at all.** Its
// manifest in the host's `mcp/modules-mount.ts` (`JD_SCAFFOLD_MANIFEST`) is a
// `summary` plus a `directory` of seven tool rows and nothing else — checked at
// the extraction, not assumed: the manifest literal contains no `config` key,
// and its own preceding comment says so ("No config fields yet — templates_folder
// is an explicit argument on each of the three template-creation tools instead of
// a module-level setting … so jd-scaffold still has no per-vault knobs at the
// MODULE level").
//
// So there is nothing for this plugin to adopt, and building the adoption
// machinery anyway — a latch, an ADOPTABLE_KEYS list, a `hostSettings ===
// undefined` guard — would be ceremony copying zero keys. It is deliberately
// absent. `DEFAULT_PLUGIN_SETTINGS` having NO keys is pinned by test, so the day
// someone adds one they have to come here and decide what adoption (if any) it
// needs.
//
// The one host setting the module DID have — the module host's `enabled: false`
// toggle — did not survive the boundary either, and could not: it was the module
// host's own row, not a jd-scaffold config field. For a satellite, "enabled"
// means the plugin is installed and enabled in Obsidian. No shipped string in
// this package may claim otherwise, and none may point at
// `modules.jd-scaffold.config.*`, which names nothing anywhere.

/** The satellite's persisted settings: none. Typed rather than deleted so a
 *  future setting has an obvious home and `settingsOf` has something to
 *  return. */
export type JdScaffoldPluginSettings = Record<string, never>;

export const DEFAULT_PLUGIN_SETTINGS: JdScaffoldPluginSettings = {};

/** Coerce whatever `loadData()` returned into a settings object. A hand-edited
 *  or corrupt data.json degrades to the defaults rather than throwing during
 *  onload. With no keys to read this is total by construction — kept so the
 *  load path does not have to change shape when the first setting arrives. */
export function settingsOf(_raw: unknown): JdScaffoldPluginSettings {
  return { ...DEFAULT_PLUGIN_SETTINGS };
}
