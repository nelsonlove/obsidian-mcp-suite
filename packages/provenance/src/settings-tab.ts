// settings-tab.ts — the plugin's own settings tab.
//
// While the provenance surface was a capability module inside the Governor host,
// its configuration was rendered by the host's generic, manifest-driven config
// tab. A satellite has no such host, so it renders its own. The FIELDS
// themselves (keys, labels, help text) live in settings.ts as pure data, so they
// stay headless-testable and the tab is only the rendering.
//
// Validation is LOUD, never coercing: `validateProvenanceConfig` (the same
// function the host's manifest used) reports a blank or absolute notesDir, an
// unknown layout, or a folder-shaped auditNote UNDER the fields rather than
// silently substituting a default. `provenanceConfigOf` will still degrade at
// use time — a hand-edited value must never crash a tool — but the user sees
// what they typed and what it will actually do.

import { PluginSettingTab, Setting, type App } from "obsidian";
import { PROVENANCE_FIELDS } from "./settings.js";
import { DEFAULT_PROVENANCE_CONFIG, validateProvenanceConfig } from "./kernel/index.js";

/** What the tab needs from the plugin — kept structural so the tab never
 *  imports main.ts (and main.ts's import of the tab stays one-directional). */
export interface ProvenanceSettingsHost {
  getConfig(): Record<string, unknown>;
  setConfig(key: string, value: unknown): Promise<void>;
}

export class ProvenanceSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly host: ProvenanceSettingsHost, pluginRef: import("obsidian").Plugin) {
    super(app, pluginRef);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const config = this.host.getConfig();
    const defaults = DEFAULT_PROVENANCE_CONFIG as unknown as Record<string, unknown>;
    /** The effective value: the user's override, else the shipped default. */
    const valueOf = (key: string): unknown => (config[key] !== undefined ? config[key] : defaults[key]);

    for (const field of PROVENANCE_FIELDS) {
      const setting = new Setting(containerEl).setName(field.label).setDesc(field.help);
      setting.addText((t) =>
        t.setValue(String(valueOf(field.key) ?? "")).onChange((raw) => {
          // A blank box clears the override so the shipped default applies
          // again — persisting "" would be a value, not a reset.
          if (raw.trim() === "") {
            void this.host.setConfig(field.key, undefined);
            return;
          }
          // Stored VERBATIM, never coerced: `validateProvenanceConfig` then
          // names a bad value under the fields, and `provenanceConfigOf` falls
          // back to the default at use time. A silent fixup here would hide the
          // typo — which is exactly how #257 shipped an audit that scanned a
          // folder nobody had had for a year.
          void this.host.setConfig(field.key, raw);
        }),
      );
    }

    const problems = validateProvenanceConfig(config);
    if (problems.length) {
      const box = containerEl.createDiv({ cls: "mod-warning" });
      box.createEl("p", { text: "Configuration problems:" });
      const list = box.createEl("ul");
      for (const problem of problems) list.createEl("li", { text: problem });
    }

    // The host is REQUIRED, as it is for the triage, cross-session and bases
    // satellites: this plugin's whole surface is the three published tools —
    // there is no pane, no command, no ribbon. Say so rather than leaving a user
    // to wonder why nothing happens. And say the allowlist posture truthfully:
    // it is FAIL-CLOSED on the whole surface, deliberately, which is a real
    // change in availability for anyone running an allowlist.
    const hostLoaded = !!(this.app as unknown as {
      plugins?: { plugins?: Record<string, unknown> };
    }).plugins?.plugins?.["governor"];
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: hostLoaded
        ? "Governor is installed: the vault_provenance_check, _reconcile and _regen MCP tools are published to it. " +
          "Note that under an active Governor path allowlist ALL THREE are refused outright — none of them carries " +
          "an argument the host recognizes as a path, so none can be scoped. That is deliberate: the freshness " +
          "answer names every file a note derives from, and the audit reads the whole notes root, so a scoped " +
          "answer would be a misleading one. With no allowlist configured nothing changes."
        : "Governor is NOT installed. This plugin's entire surface is the three MCP tools it publishes to the " +
          "Governor host, so nothing here does anything until Governor is installed and enabled.",
    });
  }
}
