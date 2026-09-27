// settings-tab.ts — the plugin's own settings tab.
//
// While the compiler was a capability module inside the Governor host, its
// configuration was rendered by the host's generic, manifest-driven config tab.
// A satellite has no such host, so it renders its own — which is what the
// standalone vault-skills plugin did before the fold. The FIELDS themselves
// (keys, labels, help text) live in settings.ts as pure data, so they stay
// headless-testable and the tab is only the rendering.
//
// Validation is LOUD, never coercing: `validateSkillsConfig` (the same function
// the host's manifest used) reports an empty plugin name or an out-of-range
// value under the fields rather than silently substituting a default, so the
// user sees the consequence of what they typed.

import { Notice, PluginSettingTab, Setting, type App } from "obsidian";
import { SKILLS_FIELDS, textAreaValue } from "./settings.js";
import { typeMapLines, typeMapOf } from "./kernel/index.js";
import { DEFAULT_SKILLS_CONFIG, validateSkillsConfig } from "./kernel/index.js";

/** What the tab needs from the plugin — kept structural so the tab never
 *  imports main.ts (and main.ts's import of the tab stays one-directional). */
export interface SkillsSettingsHost {
  getConfig(): Record<string, unknown>;
  setConfig(key: string, value: unknown): Promise<void>;
}

export class SkillsSettingTab extends PluginSettingTab {
  /** The textareas' blur handlers, so `hide()` can flush an edit the user made
   *  and then closed the tab over (Escape detaches the element without a blur). */
  private pendingFlushes: Array<() => void> = [];
  private problemsEl: HTMLElement | null = null;

  constructor(app: App, private readonly host: SkillsSettingsHost, private readonly pluginRef: import("obsidian").Plugin) {
    super(app, pluginRef);
  }

  hide(): void {
    for (const flush of this.pendingFlushes) flush();
    this.pendingFlushes = [];
    this.problemsEl = null;
  }

  /** Re-render only the problems box, never the whole tab: a full re-render
   *  from inside a blur handler destroys the element the user just clicked
   *  into, so the click between two textareas would be eaten. */
  private renderProblems(): void {
    const box = this.problemsEl;
    if (!box) return;
    box.empty();
    const problems = validateSkillsConfig(this.host.getConfig());
    if (!problems.length) { box.removeClass("mod-warning"); return; }
    box.addClass("mod-warning");
    box.createEl("p", { text: "Configuration problems:" });
    const list = box.createEl("ul");
    for (const problem of problems) list.createEl("li", { text: problem });
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.pendingFlushes = [];

    const config = this.host.getConfig();
    /** The effective value: the user's override, else the shipped default. */
    const valueOf = (key: string): unknown =>
      config[key] !== undefined ? config[key] : (DEFAULT_SKILLS_CONFIG as unknown as Record<string, unknown>)[key];

    for (const field of SKILLS_FIELDS) {
      const setting = new Setting(containerEl).setName(field.label).setDesc(field.help);
      const commit = (value: unknown) => void this.host.setConfig(field.key, value);
      if (field.type === "toggle") {
        setting.addToggle((t) => t.setValue(valueOf(field.key) === true).onChange(commit));
      } else if (field.type === "select") {
        setting.addDropdown((d) => {
          for (const option of field.options ?? []) d.addOption(option, option);
          d.setValue(String(valueOf(field.key) ?? "")).onChange(commit);
        });
      } else if (field.type === "lines" || field.type === "typemap") {
        // A textarea, committed on BLUR — saving per keystroke walks a list
        // through states like ["0"] that read as real entries (the host's
        // territories field learned the same lesson).
        setting.addTextArea((t) => {
          const current = valueOf(field.key);
          t.setValue(field.type === "typemap"
            ? typeMapLines(typeMapOf(current))
            : Array.isArray(current) ? (current as unknown[]).map(String).join("\n") : "");
          t.inputEl.rows = 5;
          const flush = () => {
            const { value, problems } = textAreaValue(field, t.inputEl.value);
            if (problems.length) {
              // Leave the text exactly as typed and say what is wrong with it;
              // committing the good lines would silently delete the bad one.
              new Notice(`${field.label}: not saved —\n${problems.join("\n")}`, 8000);
              return;
            }
            commit(value);
            this.renderProblems();
          };
          this.pendingFlushes.push(flush);
          t.inputEl.addEventListener("blur", flush);
        });
      } else if (field.type === "number") {
        setting.addText((t) =>
          t.setValue(String(valueOf(field.key) ?? "")).onChange((raw) => {
            const n = Number(raw);
            // A blank box clears the override (back to the default); anything
            // unparseable is left alone rather than persisted as NaN.
            if (raw.trim() === "") commit(undefined);
            else if (Number.isFinite(n)) commit(n);
          }),
        );
      } else {
        setting.addText((t) => t.setValue(String(valueOf(field.key) ?? "")).onChange(commit));
      }
    }

    this.problemsEl = containerEl.createDiv();
    this.renderProblems();

    // The host is optional (see main.ts). Say so here rather than leaving a
    // user to wonder why the tools are missing from an agent session.
    const hostLoaded = !!(this.app as unknown as {
      plugins?: { plugins?: Record<string, unknown> };
    }).plugins?.plugins?.["governor"];
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: hostLoaded
        ? "Governor is installed: the six vaultmcp_skills_* MCP tools are published to it. Note that under an active Governor path allowlist all of them except vaultmcp_skills_mark are refused — they carry no path argument to scope."
        : "Governor is not installed. The pane, commands, and export all still work; only the six vaultmcp_skills_* MCP tools are unpublished.",
    });
  }
}
