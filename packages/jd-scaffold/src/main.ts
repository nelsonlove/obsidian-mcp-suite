// VAULT JD SCAFFOLD — Johnny Decimal category scaffolding as its own Obsidian
// plugin.
//
// Published to the Governor host through vault-mcp-api as seven MCP tools, all
// mutating:
//
//   vaultmcp_jd_scaffold_standard_zeros          — the fixed 10-note zeros set
//   vaultmcp_jd_scaffold_ensure_category_indexes — vault-wide XX.00 self-heal
//   vaultmcp_jd_scaffold_promote_to_folder       — id note → same-named folder
//   vaultmcp_jd_scaffold_reindex_category        — rebuild an XX.00's Contents
//   vaultmcp_jd_scaffold_new_standard_zero       — one zero slot from a template
//   vaultmcp_jd_scaffold_new_generic_id          — an XX.YY note from a template
//   vaultmcp_jd_scaffold_new_stem                — an XX.00+CODE note from a template
//
// SATELLITE OF THE SUITE. Extracted out of the host with the mutating tier,
// following the quickadd-choices-compile pilot and the vaultmcp-skills (S4),
// vaultmcp-triage (S5), vaultmcp-crosssession (S6) and vaultmcp-bases (S7) satellites.
// Consequences of the publishing contract, each deliberate and each recorded in
// CLAUDE.md rather than buried here:
//
//   * THE PUBLISHED TOOL NAMES CHANGED — `obsidian_jd_*` became
//     `vaultmcp_jd_scaffold_*`. Half of that is the usual namespace composition
//     (the host publishes `<sanitized publisher id>_<bare name>`), and half was
//     FORCED: the host's registry refuses any published name starting
//     `obsidian_`, so no plugin id could have carried the shipped spellings.
//   * THE ALLOWLIST BOUNDARY MOVED TO THE HOST. After round 2 (2026-09-07):
//     five of the seven tools name no note, carry no argument the host
//     recognizes as a path key, and are blocked outright under an active path
//     allowlist. The two that DO name a note call it `note_path`, which IS a
//     key, so they are scoped to that note and the kernel's record guard, lock
//     consult and journal target all see it. tools.ts explains the whole three-
//     round history, including the ONE ratified residual — `reindex_category`'s
//     vault-wide sibling read is not scoped by its note argument.
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
      console.error("[vaultmcp-jd-scaffold] publishing the tool surface failed", e);
    }
  }
}
