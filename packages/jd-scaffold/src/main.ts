// VAULT JD SCAFFOLD — Johnny Decimal category scaffolding as its own Obsidian
// plugin.
//
// Published to the Governor host through vault-mcp-api as seven MCP tools, all
// mutating:
//
//   vault_jd_scaffold_standard_zeros          — the fixed 10-note zeros set
//   vault_jd_scaffold_ensure_category_indexes — vault-wide XX.00 self-heal
//   vault_jd_scaffold_promote_to_folder       — id note → same-named folder
//   vault_jd_scaffold_reindex_category        — rebuild an XX.00's Contents
//   vault_jd_scaffold_new_standard_zero       — one zero slot from a template
//   vault_jd_scaffold_new_generic_id          — an XX.YY note from a template
//   vault_jd_scaffold_new_stem                — an XX.00+CODE note from a template
//
// SATELLITE OF THE SUITE. Extracted out of the host with the mutating tier,
// following the quickadd-choices-compile pilot and the vault-skills (S4),
// vault-triage (S5), vault-crosssession (S6) and vault-bases (S7) satellites.
// Consequences of the publishing contract, each deliberate and each recorded in
// CLAUDE.md rather than buried here:
//
//   * THE PUBLISHED TOOL NAMES CHANGED — `obsidian_jd_*` became
//     `vault_jd_scaffold_*`. Half of that is the usual namespace composition
//     (the host publishes `<sanitized publisher id>_<bare name>`), and half was
//     FORCED: the host's registry refuses any published name starting
//     `obsidian_`, so no plugin id could have carried the shipped spellings.
//   * THE ALLOWLIST BOUNDARY MOVED TO THE HOST, and for this surface it closes
//     harder than the in-tool checks it replaces: no tool carries an argument
//     the host recognizes as a path key, so under an active path allowlist the
//     host blocks all seven outright. Fail-closed. tools.ts explains why
//     `path` → `note_path` was the right rename rather than the wrong one.
//   * REFUSALS THROW; the host renders a thrown error's lowercase-snake `code`
//     as `Error [code]: message`, the envelope the module already produced.
//   * The host's queue, journal, record-immutability guard and kernel args
//     still apply — external mutating tools ride the guarded registration path
//     like every built-in.
//
// THIS PLUGIN NEEDS THE HOST, like the triage, cross-session and bases
// satellites. It has no pane, no palette command and no ribbon: its entire
// surface is the seven published tools. With Governor absent it loads and does
// nothing — `publishTools` waits on the host's ready event and registers if a
// host appears. The settings tab says so plainly.
//
// NO ADOPTION, AND NO REPUBLISH — both are absences with reasons:
//
//   * The module declared NO config block, so there is no host setting to adopt
//     (checked, not assumed — see settings.ts). Every predecessor satellite
//     needed a one-shot latch; this one has nothing to latch over.
//   * And because there is no config, nothing a settings write could change
//     reaches the specs: the tool descriptions render no configurable value, so
//     a `republish()` would rebuild an identical spec set. Publishing ONCE in
//     onload, with the disposer handed straight to `this.register`, is
//     therefore correct here rather than a simplification of the triage/bases
//     pattern. If a setting is ever added that a description renders, the
//     dispose-and-re-publish pattern comes back with it.

import { Plugin, parseYaml } from "obsidian";
import { publishTools } from "vault-mcp-api";
import { buildJdScaffoldTools } from "./tools.js";
import { obsidianJdScaffoldSource } from "./obsidian-source.js";
import { JdScaffoldSettingTab } from "./settings-tab.js";
import { settingsOf, DEFAULT_PLUGIN_SETTINGS, type JdScaffoldPluginSettings } from "./settings.js";

export default class VaultJdScaffoldPlugin extends Plugin {
  settings: JdScaffoldPluginSettings = { ...DEFAULT_PLUGIN_SETTINGS };

  async onload(): Promise<void> {
    // No keys today, but the load path keeps its shape: a corrupt or
    // hand-edited data.json degrades to the defaults instead of throwing
    // during onload.
    this.settings = settingsOf(await this.loadData());

    this.addSettingTab(new JdScaffoldSettingTab(this.app, this));

    // `publishTools` is internally defensive (it registers now or on the host's
    // ready event and never throws out of onload), but a failure here must not
    // be able to take down the settings tab either, so it is caught and
    // reported.
    try {
      this.register(
        publishTools(
          this,
          buildJdScaffoldTools(obsidianJdScaffoldSource(this.app), {
            // Obsidian's own YAML parser, injected so tools.ts needs no
            // `obsidian` import. WITHOUT it the accept-fence scan fails closed
            // on any frontmatter-carrying template at all, which would refuse
            // every real template-creation call — so this is load-bearing, not
            // decoration.
            parseYaml,
            // `getSettings` is deliberately NOT supplied — a satellite cannot
            // reach the host's guard settings, and the host's external-tool
            // gate is the enforced boundary. See tools.ts.
          }),
        ),
      );
    } catch (e) {
      console.error("[vault-jd-scaffold] publishing the tool surface failed", e);
    }
  }
}
