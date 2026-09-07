// settings-tab.ts — the plugin's own settings tab.
//
// It has NO SETTINGS TO RENDER, and that is correct: the jd-scaffold module
// declared no config block, so there is nothing to configure (see settings.ts).
// The tab ships anyway, and is worth shipping, because a user who installs this
// plugin needs to be told two things they cannot discover any other way:
//
//   1. It does nothing without the Governor host. The plugin's entire surface is
//      the seven MCP tools it publishes — no pane, no palette command, no
//      ribbon. With Governor absent it loads and sits there.
//   2. Under an ACTIVE Governor path allowlist, five of the seven are refused
//      outright and the two that name a note are scoped to it (round 2,
//      2026-09-07) — including reindex's ratified sibling-read residual.
//      That is deliberate and fail-closed (no argument here is a path key the
//      host can scope by), but a user watching every call refuse deserves to
//      know it is the posture rather than a bug.

import { PluginSettingTab, type App } from "obsidian";

export class JdScaffoldSettingTab extends PluginSettingTab {
  constructor(app: App, pluginRef: import("obsidian").Plugin) {
    super(app, pluginRef);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const hostLoaded = !!(this.app as unknown as {
      plugins?: { plugins?: Record<string, unknown> };
    }).plugins?.plugins?.["governor"];

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: hostLoaded
        ? "Governor is installed: the vault_jd_scaffold_standard_zeros, _ensure_category_indexes, _promote_to_folder, _reindex_category, _new_standard_zero, _new_generic_id and _new_stem MCP tools are published to it."
        : "Governor is NOT installed. This plugin's entire surface is the seven MCP tools it publishes to the Governor host, so nothing here does anything until Governor is installed and enabled.",
    });

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "There is nothing to configure. This plugin has no settings of its own — every tool takes what it needs (the category folder, the prefix, the templates folder) as a call argument.",
    });

    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Under an ACTIVE Governor path allowlist, five of the seven tools are refused outright — they name no note, so Governor has nothing to scope them by, and the folders and files they write are computed rather than named. The two that DO name a note (promote to folder, reindex category) name it `note_path`, which Governor recognizes as a path, so those two are scoped to that note and its record-immutability guard, lock consult and journal target all see it. One residual, stated plainly: reindex's area and system tiers read every sibling XX.00 index file in the vault, and that read is not scoped by the note argument — so under an allowlist those tiers can fold hidden siblings' names into a visible note. With no allowlist configured all seven behave exactly as before.",
    });
  }
}
