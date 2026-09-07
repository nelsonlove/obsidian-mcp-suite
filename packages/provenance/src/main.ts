// VAULT PROVENANCE — derived-content provenance as its own Obsidian plugin.
//
// Published to the Governor host through vault-mcp-api as three MCP tools:
//
//   vault_provenance_check     — is a derived note FRESH or STALE against its
//                                own `derived-from:` sources (read-only in
//                                intent; the host distrusts that claim);
//   vault_provenance_reconcile — installed vs enabled vs noted Obsidian plugins;
//   vault_provenance_regen     — regenerate the plugin-audit note; dry-run by
//                                default, `write: true` persists (MUTATING).
//
// SATELLITE OF THE SUITE (suite-split design §6). Extracted out of the host
// after the quickadd-choices-compile pilot, the vault-skills (S4), vault-triage
// (S5), vault-crosssession (S6) and vault-health / vault-vocab / vault-bases
// (S7) satellites. Consequences of the publishing contract, each deliberate:
//
//   * THE PUBLISHED TOOL NAMES CHANGED — `provenance_*` became
//     `vault_provenance_*`, with the bare names shedding the `provenance_`
//     prefix so nothing publishes as `vault_provenance_provenance_check`. The
//     host publishes an external tool as `<sanitized publisher id>_<bare name>`,
//     so the plugin id IS the tool namespace. Same rename class as bases'.
//     Recorded in CLAUDE.md and README.md, not buried here.
//   * ONE ARGUMENT WAS RENAMED TOO: `check`'s `path` is now `note_path`, so
//     that NO tool here carries an argument the host recognizes as a path key.
//     Under an active path allowlist the host therefore blocks the ENTIRE
//     surface outright. Fail-closed, uniform, and stated plainly in the settings
//     tab. See tools.ts for the full argument.
//   * REFUSALS THROW; the host renders a thrown error's lowercase-snake `code`
//     as `Error [code]: message`, the envelope the module already produced.
//   * The host's queue, journal, read-only mode and kernel args still apply —
//     external mutating tools ride the guarded registration path like every
//     built-in. Publishing exempts a tool from nothing.
//
// THIS PLUGIN NEEDS THE HOST, like the triage, cross-session and bases
// satellites and unlike skills. It has no pane, no palette command and no
// ribbon: its entire surface is the three published tools. With Governor absent
// it loads, keeps and validates its settings, adopts nothing, and does nothing —
// `publishTools` waits on the host's ready event and registers if one appears.
// The settings tab says so plainly.
//
// ONE ADOPTION, not two. Config adopts once out of the host's
// `modules.provenance.config`. There is no second adoption because there is no
// live operational state outside data.json — checked, not assumed; see the
// finding recorded in settings.ts.
//
// RE-PUBLISHING ON CONFIG CHANGE, as in the triage / cross-session / bases
// satellites. The host snapshots a published spec when it registers it, so a
// description or a schema frozen at plugin load would be reported to every agent
// reading the tool list until an Obsidian reload. Disposing and re-publishing on
// every settings write restores the per-connection freshness the module had.
// (The HANDLERS read config per call regardless — `ProvenanceToolsCtx.config` is
// a thunk. The module read it ONCE at registration; as a satellite that would
// have meant a settings change never landing at all until a reload.)

import { Plugin } from "obsidian";
import { publishTools } from "vault-mcp-api";
import { buildProvenanceTools } from "./tools.js";
import { obsidianProvenanceBackend } from "./obsidian-source.js";
import { ProvenanceSettingTab } from "./settings-tab.js";
import {
  runConfigAdoption,
  settingsOf,
  DEFAULT_PLUGIN_SETTINGS,
  type ProvenancePluginSettings,
} from "./settings.js";

/** The host plugin's ids, newest first — the same pair vault-mcp-api reads, and
 *  for the same reason (Governor renamed `vault-mcp` → `governor` in 0.12.0).
 *  Used ONLY to find the settings to adopt from; publishing itself is entirely
 *  vault-mcp-api's business. */
const HOST_PLUGIN_IDS = ["governor", "vault-mcp"] as const;

interface HostPluginLike {
  settings?: unknown;
}

export default class VaultProvenancePlugin extends Plugin {
  settings: ProvenancePluginSettings = { ...DEFAULT_PLUGIN_SETTINGS };

  /** The live `publishTools` disposer, or null when nothing is published.
   *  Held rather than handed straight to `this.register` because a config
   *  change has to revoke and re-publish — see the header. */
  private unpublish: (() => void) | null = null;

  async onload(): Promise<void> {
    this.settings = settingsOf(await this.loadData());

    await this.adoptFromHostOnce();

    this.addSettingTab(
      new ProvenanceSettingTab(
        this.app,
        {
          getConfig: () => this.settings.config,
          setConfig: async (key, value) => {
            // `undefined` clears the override so the shipped default applies
            // again — persisting `undefined` would be a JSON hole, not a reset.
            if (value === undefined) delete this.settings.config[key];
            else this.settings.config[key] = value;
            await this.saveData(this.settings);
            this.republish();
          },
        },
        this,
      ),
    );

    // Unpublish on unload however we got here — including a republish that
    // never happened because publishing threw.
    this.register(() => {
      this.unpublish?.();
      this.unpublish = null;
    });

    this.republish();
  }

  /**
   * Revoke whatever is published and publish a freshly built set of specs.
   *
   * `publishTools` is internally defensive (it registers now or on the host's
   * ready event and never throws out of onload), but a failure here must not be
   * able to take down the settings tab either, so it is caught and reported.
   */
  private republish(): void {
    try {
      this.unpublish?.();
      this.unpublish = null;
      this.unpublish = publishTools(
        this,
        buildProvenanceTools(obsidianProvenanceBackend(this.app as never), {
          // Read per call, never captured: the host holds a spec snapshot per
          // connection, so a captured config would freeze the settings tab's
          // values at plugin load. (The descriptions are necessarily build-time
          // snapshots regardless, which is why this method exists.)
          config: () => this.settings.config,
          // `getSettings` is deliberately NOT supplied — a satellite cannot
          // reach the host's guard settings, and the host's external-tool gate
          // is the enforced boundary. See tools.ts.
        }),
      );
    } catch (e) {
      console.error("[vault-provenance] publishing the tool surface failed", e);
    }
  }

  /** The host plugin instance, newest id first, or undefined. */
  private hostPlugin(): HostPluginLike | undefined {
    const plugins = (this.app as unknown as {
      plugins?: { plugins?: Record<string, HostPluginLike> };
    }).plugins?.plugins;
    for (const id of HOST_PLUGIN_IDS) {
      const host = plugins?.[id];
      if (host) return host;
    }
    return undefined;
  }

  /**
   * One-shot settings adoption from the host's `modules.provenance.config`.
   *
   * The host's copy is READ and never written — see settings.ts for the three
   * rules.
   */
  private async adoptFromHostOnce(): Promise<void> {
    if (this.settings.adoptedFromHost) return;
    // `settings` is declared without an initializer on the host and only
    // assigned mid-onload — a plugin instance can be visible in the map before
    // that assignment runs. Treating that as "host present, empty settings"
    // would burn the one-shot latch on nothing and the user's config would
    // never adopt. An undefined settings bag reads as HOST NOT READY, exactly
    // like an absent host: adoption retries next load.
    const host = this.hostPlugin();
    const hostSettings = host && host.settings !== undefined ? host.settings : undefined;
    // EVERY FAILURE PATH HOLDS THE LATCH OPEN (the cross-session review's
    // lesson, implemented rather than merely promised, and testable because the
    // persistence is injected): `runConfigAdoption` only returns the adopted
    // object once `saveData` has RESOLVED. A throwing write leaves
    // `adoptedFromHost` false in memory and on disk, and the next load retries —
    // instead of a burnt latch and a log line claiming success.
    const outcome = await runConfigAdoption(this.settings, hostSettings, (s) => this.saveData(s));
    this.settings = outcome.settings;
    if (!outcome.persisted) {
      console.error("[vault-provenance] adopted config could not be persisted; will retry next load");
      return;
    }
    if (outcome.adopted) {
      console.info("[vault-provenance] adopted the Governor host's modules.provenance.config (one shot; the host's copy is untouched)");
    }
  }
}
