// settings-tab.ts — the plugin's own settings tab.
//
// While the fileclass surface was a capability module inside the Governor host,
// its one config field was rendered by the host's generic, manifest-driven
// config tab. A satellite has no such host, so it renders its own. The FIELD
// definitions (key, label, help text) live in settings.ts as pure data, so they
// stay headless-testable and the tab is only the rendering.
//
// Validation is LOUD, never coercing: `validateFileclassConfig` (the same
// function the host's manifest used) reports a non-string `binaryPath` under the
// field rather than silently substituting a default, so the user sees the
// consequence of what they typed.
//
// The status paragraph is the only place a user learns why the plugin might be
// silent, and there are THREE distinct silences here — more than any other
// satellite has. It must name whichever one applies rather than leaving a user
// to guess.

import { PluginSettingTab, Setting, type App } from "obsidian";
import { FILECLASS_FIELDS, DEFAULT_FILECLASS_CONFIG, validateFileclassConfig } from "./settings.js";
import { FILECLASS_PLUGIN_ID, findFileclassBinary } from "./tools.js";

/** What the tab needs from the plugin — kept structural so the tab never
 *  imports main.ts (and main.ts's import of the tab stays one-directional). */
export interface FileclassSettingsHost {
  getConfig(): Record<string, unknown>;
  setConfig(key: string, value: unknown): Promise<void>;
}

export class FileclassSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly host: FileclassSettingsHost, pluginRef: import("obsidian").Plugin) {
    super(app, pluginRef);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const config = this.host.getConfig();
    /** The effective value: the user's override, else the shipped default. */
    const valueOf = (key: string): unknown =>
      config[key] !== undefined ? config[key] : DEFAULT_FILECLASS_CONFIG[key];

    for (const field of FILECLASS_FIELDS) {
      new Setting(containerEl).setName(field.label).setDesc(field.help).addText((t) =>
        t.setValue(String(valueOf(field.key) ?? "")).onChange((raw) => {
          // A blank box clears the override so the shipped default applies
          // again — persisting "" as an override rather than as a reset would
          // work here (blank IS the default) but would still leave a key in
          // data.json that the user asked to remove.
          if (raw.trim() === "") {
            void this.host.setConfig(field.key, undefined);
            return;
          }
          void this.host.setConfig(field.key, raw);
        }),
      );
    }

    const problems = validateFileclassConfig(config);
    if (problems.length) {
      const box = containerEl.createDiv({ cls: "mod-warning" });
      box.createEl("p", { text: "Configuration problems:" });
      const list = box.createEl("ul");
      for (const problem of problems) list.createEl("li", { text: problem });
    }

    // ── the three silences ────────────────────────────────────────────────
    const plugins = (this.app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins;
    const hostLoaded = !!plugins?.["governor"];
    const fileclassLoaded = !!plugins?.[FILECLASS_PLUGIN_ID];
    const configured = typeof config.binaryPath === "string" && config.binaryPath.trim() !== "";
    const binary = configured ? String(config.binaryPath).trim() : findFileclassBinary();

    const say = (text: string) => containerEl.createEl("p", { cls: "setting-item-description", text });

    if (!hostLoaded) {
      say(
        "Governor is NOT installed. This plugin's entire surface is the eight MCP tools it publishes to the Governor " +
          "host, so nothing here does anything until Governor is installed and enabled.",
      );
    } else if (!fileclassLoaded) {
      say(
        "The Fileclass plugin is not loaded, so no tools are published. This plugin proxies the Fileclass engine " +
          "through its CLI; without the plugin there is nothing to proxy.",
      );
    } else if (!binary) {
      say(
        "The `fileclass` CLI binary was not found, so no tools are published. Install it, or set its absolute path " +
          "above.",
      );
    } else {
      say(
        `Governor is installed and the fileclass CLI was found at ${binary}: the vaultmcp_fileclass_list, _schema, ` +
          "_explain, _query, _get, _validate, _set and _set_where MCP tools are published to it.",
      );
    }

    say(
      "Under an active Governor path allowlist SEVEN of the eight tools are refused outright and one is scoped. " +
        "Five (list, schema, query, validate, set_where) name no note at all, and the two READ tools that do " +
        "(explain, get) name it `note`, which the host does not recognize as a path key — deliberate, because the " +
        "fileclass CLI runs its engine over the whole vault and resolves inheritance from definitions a scoped " +
        "session cannot see, so a half-scoped answer would name notes outside the allowlist. The exception is `set`: " +
        "its `note_path` argument IS a host path key, so the host scopes the write per-path AND its record-" +
        "immutability guard, lock consult and journal target all see the note being written. That trade is the point " +
        "— a read gains nothing from being scopable, a write gains the kernel's protection.",
    );

    say(
      "The published tool set is decided when this plugin loads and again on every change above — not per MCP " +
        "session. If you install the Fileclass plugin or the CLI while this plugin is running, reload it (or edit a " +
        "setting) before the tools appear.",
    );
  }
}
