# Vault JD Scaffold (plugin id `vault-jd-scaffold`)

Johnny Decimal scaffolding, given an agent surface: create a category's fixed standard-zeros set, self-heal missing `XX.00` index files across the vault, promote an id note into a same-named folder (link-healing), rebuild an index file's `## Contents` section from the vault's own structure, and create standard-zero / generic-id / stem notes from templates classified by their own `jd-id` frontmatter. Every tool previews with `dry_run: true`.

Like the triage, cross-session and bases satellites and unlike the skills one, this plugin has no human surface at all — no pane, no palette command, no ribbon. Its entire surface is seven MCP tools published to the Governor host through `vault-mcp-api`, plus a settings tab that exists only to tell a human what the plugin needs and what it refuses.

## Lineage

Built as the host's `jd-scaffold` capability module — Stages A, A2 and A3 of the jd-dashboard fold, ported from `obsidian-jd-dashboard`'s `standard-zeros.ts`, `promote-to-folder.ts`, `category-index.ts` and `templates.ts` / `new-from-template.ts`. Extracted to its own plugin with the suite split's **mutating tier**, following `packages/quickadd-choices-compile` (the pilot) and the satellites `packages/skills` (`vault-skills`, S4), `packages/triage` (`vault-triage`, S5), `packages/crosssession` (`vault-crosssession`, S6) and `packages/bases` (`vault-bases`, S7). The planners, the template classifier, the placeholder engine and the three reindex tiers are the same code through both homes; only who mounts them differs.

## Package layout

```text
packages/jd-scaffold/
├── manifest.json          plugin id `vault-jd-scaffold`, isDesktopOnly
├── esbuild.config.mjs     bundles src/main.ts → main.js (no assets, no defines)
├── src/
│   ├── main.ts            onload: settings, settings tab, publishTools (once — there is no config to re-publish for)
│   ├── settings.ts        the settings shape, which is EMPTY, and the checked reason why
│   ├── settings-tab.ts    the plugin's own settings tab: host status + the allowlist posture
│   ├── tools.ts           the seven tool specs, the injected JdScaffoldSource seam, the ctx
│   ├── obsidian-source.ts the live vault adapter — including the link-healing rename
│   └── kernel/            the pure core — Obsidian-free, no vault, no clock
│       ├── types.ts             plan/result shapes and the injected `exists` predicates
│       ├── standard-zeros.ts    the fixed 00-09 set, its frontmatter, and both zero planners
│       ├── promote-to-folder.ts the id-note → folder plan and its three refusals
│       ├── sections.ts          the generic `## Heading` section upsert
│       ├── templates.ts         jd-id classification, placeholder substitution, destination paths
│       └── category-index.ts    the three reindex tiers and description preservation
└── tests/                 170 tests; everything but the settings tab is headless
```

Installed into a vault this is two files — `main.js` and `manifest.json` — plus, during development, an empty `.hotreload` marker in the installed plugin directory so the hot-reload plugin picks up rebuilds. The `.hotreload` file lives in the vault install, never in this repo.

## Build and test

```bash
npm run build          # esbuild → main.js
npm test               # tsc --noEmit && node --test 'tests/*.test.mjs'
```

`pretest` rebuilds `@vault-mcp/core` first, for the same reason the host's and the other satellites' do: the tests reach published core contracts (`isVisible`, `scanForAcceptFence`) through `packages/core/dist`, so without the rebuild you are testing the previous build's bytes.

## It does NOT work without the host

Same as the triage, cross-session and bases satellites. The seven published tools ARE the plugin. With Governor absent it loads, keeps its (empty) settings, and does nothing; `publishTools` waits on the host's ready event and registers the moment a host appears. The settings tab says so.

## What the extraction changed

### 1. Every published tool name changed, and half of it was forced

| shipped by the module | bare name in this package | published by the satellite |
|---|---|---|
| `obsidian_jd_standard_zeros` | `standard_zeros` | **`vault_jd_scaffold_standard_zeros`** |
| `obsidian_jd_ensure_category_indexes` | `ensure_category_indexes` | **`vault_jd_scaffold_ensure_category_indexes`** |
| `obsidian_jd_promote_to_folder` | `promote_to_folder` | **`vault_jd_scaffold_promote_to_folder`** |
| `obsidian_jd_reindex_category` | `reindex_category` | **`vault_jd_scaffold_reindex_category`** |
| `obsidian_jd_new_standard_zero` | `new_standard_zero` | **`vault_jd_scaffold_new_standard_zero`** |
| `obsidian_jd_new_generic_id` | `new_generic_id` | **`vault_jd_scaffold_new_generic_id`** |
| `obsidian_jd_new_stem` | `new_stem` | **`vault_jd_scaffold_new_stem`** |

**This breaks any agent session or saved prompt that calls the old names.** That cost is real and should not be understated: the host's own locked decision says renaming shipped tool names breaks agent sessions for zero semantic gain.

What makes this one different from its predecessors is that it was not a trade anyone could decline. Two compositions produce the new spelling — the host publishes an external tool as `<sanitized publisher id>_<bare name>`, and the bare names shed the `obsidian_jd_` prefix — and the second is **forced by the boundary**. The host refuses a published external tool whose name lands in the built-in namespace (`external-tools.ts`: a `toolName` starting `obsidian_` throws "collides with the reserved `obsidian_*` namespace"), so no plugin id whatsoever could have carried the shipped spellings through. The bases satellite's `base_` strip was a readability choice about a name the host would have accepted; this was not a choice.

**Reversing the namespace half is a one-line change** — `manifest.json`'s `id`, plus the strings in `tests/host-shim.mjs` and the settings tab's status line; nothing else encodes the prefix, since the specs carry BARE names. But be honest about what that reverses: `vault_jd_scaffold_*` could become `jd_scaffold_*`. It could never become `obsidian_jd_*` again.

### 2. The allowlist boundary moved to the host — five tools refused, two scoped, one residual ratified

The host's external-tool gate is what enforces scope now, and it refuses on two grounds:

- An external tool's `readOnlyHint: true` is a CLAIM the host distrusts unless the publisher's raw plugin id appears in its `trustedReadOnlyPlugins` setting. Not applicable here: **all seven tools are mutating and claim nothing.**
- A mutating external tool whose arguments carry **no recognized path key** is **blocked outright** while a path allowlist is active — evaluated at call time on the ACTUAL ARGUMENTS, not on the declared schema.

**Five of the seven carry no recognized path key**, so under an active allowlist those five are refused wholesale, where the module checked and filtered inside each handler. The two that NAME a note are scoped to it. The argument has been spelled three ways, and the current spelling is the one to know:

| tool | at the fold | extraction (S8) | **now (round 2, 2026-09-07)** | effect under an active allowlist |
|---|---|---|---|---|
| `promote_to_folder` | `path` | `note_path` | **`note_path`** | scoped to the source note; the kernel's record guard, lock consult and journal target see it. Its COMPUTED folder + new file are named by no argument and stay outside the guard — the `obsidian_repoint_link` boundary, mitigated by `filesChanged`/`files` |
| `reindex_category` | `path` | `note_path` | **`note_path`** | scoped to the index note written, kernel-visible — **with the ratified residual below**: the vault-wide sibling READ is not scoped by it |
| everything else | `folder_path`, `templates_folder`, `prefix`, `zero_id`, `id`, `title`, `stem_code`, `name`, `dry_run` | unchanged | unchanged | refused outright — none of these is a host path key |

`path` and (since round 1, 2026-09-07) `note_path` are both on the host's list; `folder_path` and `templates_folder` are not, verified against the host's live `PATH_KEYS` / `ARRAY_PATH_KEYS` rather than assumed.

**Round 1 (2026-09-07)** put `note_path` on the host's list, because the extraction's all-pathless rename had also taken these two writes out of `collectPaths` — which feeds record immutability, the lock consult and the journal target, **none of them allowlist-gated**. `reindex_category` could rewrite a `record: true` index note the kernel used to refuse, on every vault. **Round 2 (2026-09-07)**, after review, settled the rule that decides the spelling for anything added here: **kernel visibility is a MUTATING concern, so path-key an argument iff the tool mutates the note it names.** Every tool in this package is mutating, so the two that name a note keep `note_path`; reads elsewhere in the tier went the other way.

**THE ONE RATIFIED RESIDUAL.** `reindex_category` is mutating AND does a vault-wide sibling read. Under an active allowlist it now proceeds, scoped to the note it writes, while its area-management and system tiers read every sibling `XX.00` file — including hidden ones — and can fold their names into the visible note's `## Contents`. **That was weighed and accepted, not overlooked.** Accepted because: the kernel protection it buys is live on every vault, allowlist or not, while the leak requires an allowlist and the operator's allowlist is empty; and because the reversal is one word. **The reversal, exactly:** rename `note_path` → `note` on that one tool, and the host stops recognizing it, F3 refuses the tool wholesale again, and the record guard stops seeing the index note it rewrites. The proper fix is an apiVersion-2 `vault-mcp-api` that carries the caller's scope to a publisher, which wakes the dormant sibling filter that is still in the handler.

**Why the extraction renamed away from `path` at all** (the reasoning round 2 overturned the conclusion of, not the analysis). A satellite cannot see the host's allowlist — `ctx.getSettings` is a seam nothing supplies — so every in-handler visibility check went dormant at the extraction. Given that:

- Keeping `path` on `promote_to_folder` would have scoped the **source** note while the write goes to a folder and a new file the plan **computes**, which no argument names. The module re-checked those computed destinations itself; a satellite cannot. Handing the guard the source path while the real write targets stay unscoped is the illusion of a check.
- Keeping `path` on `reindex_category` would have scoped the note **written** while its area-management and system tiers **read every sibling `XX.00` file in the vault** and fold their names and descriptions into the new content. The module bounded that read with the allowlist; a satellite cannot. A scoped session could pull hidden siblings' names into a visible note — a read-boundary bypass.

Both bullets are still true as descriptions of what the argument does and does not cover — they are why the residual above is named a residual rather than called closed. What changed at round 2 is the verdict: the kernel checks a path key restores are worth more than the wholesale refusal, and the uncovered half is documented instead of eliminated. **The cost as the extraction shipped it — "under an active allowlist, JD scaffolding is unavailable rather than partially available" — is NO LONGER TRUE and must not be repeated.** With no allowlist configured — the ordinary case — nothing changes at all, as before.

The in-handler checks are **kept, not deleted** — dormant seams, exercised by the tests so they cannot rot, and live again with no code change the day `vault-mcp-api` can carry the caller's scope to a publisher (the apiVersion-2 item triage, cross-session and bases all named). One consequence to know: `reindex_category`'s `scoped_to_allowlist` field always reports `false` in the shipped configuration, because the plugin is never told about a scope.

### 3. Refusals throw, and three new codes joined the set

A handler returns plain data or throws; the host wraps the first in `ok()` and the second in `fail()`, and `fail()` renders a lowercase-snake `code` off the error as `Error [code]: message` — the same shape the module's `codedError` produced. **No envelope changed** (this surface never used `okError`), so every refusal an agent already knew is byte-compatible: `out_of_allowlist`, `not_id_note`, `already_cover_note`, `folder_exists`, `promote_partial`, `not_index_file`, `invalid_zero_id`, `already_exists`, `template_not_found`, `templates_folder_not_found`, `template_unreadable`, `invalid_id`, `invalid_title`, `invalid_stem_code`, `accept_forbidden`.

Three codes are **new**, and each refuses input the module accepted:

- **`invalid_path`** — a backslash in `note_path`, `folder_path` or `templates_folder`, refused before every other check. Every check downstream splits on `/` alone, so a backslash reads as one opaque segment here and as a traversal to whatever normalizes it later. The same rule the triage and bases satellites adopted.
- **`invalid_prefix`** — a `prefix` that is not exactly two digits. The module did not validate it at all, and it is concatenated straight into every computed destination, so `..`-shaped input introduced extra path segments into the write target. Same class as the stem-code check the module already had.
- **`invalid_argument`** — the re-applied non-empty-string bounds, and a non-boolean `dry_run` (which refuses rather than being read as "write for real").

**Schema bounds are re-applied in the handler.** The SDK converts a zod shape to JSON Schema and the host converts it back through a deliberately small subset: `type`, `description` and string `enum` survive; `default`, `min`, `max` and `pattern` do not. So every `.min(1)` and every type check runs again where it actually executes. This is the `vault_skills_release` semver lesson, applied before it could bite.

### 4. There was no configuration to migrate — checked, not assumed

Every satellite before this one carried a one-shot adoption of the host's `modules.<id>.config`. **The jd-scaffold module declared no `config` block at all**: its manifest in the host's `modules-mount.ts` is a summary plus seven tool rows, and its own comment says so — `templates_folder` is an explicit argument on each template-creation tool rather than a module-level setting. So there is nothing to adopt, no adoption machinery was built, and this plugin has no settings whatsoever. Recorded here so the absence is a finding rather than an oversight, and pinned by a test over `DEFAULT_PLUGIN_SETTINGS`' key set.

The module host's `enabled: false` toggle did not survive either, and could not: it was the module host's own row, not a jd-scaffold field. **For a satellite, "enabled" means the plugin is installed and enabled in Obsidian.**

### 5. One user-visible byte change: the auto-generated callout

The warning callout `reindex_category` writes into every regenerated `XX.00` index used to say "Regenerated by `obsidian_jd_reindex_category`". It now names `vault_jd_scaffold_reindex_category`, because the old spelling names a tool that cannot exist. The change lands in each index file the next time it is reindexed. Nothing parses the callout — the whole `## Contents` region is replaced on every run — but it is bytes in your vault, so it is named here rather than left to surprise a diff.

## What the host still owns

Everything a published tool rides through: the guarded registration point, read-only mode, the path allowlist, the serialized write queue, the write journal, `if_rev` / `idempotency_key` / `intent`, advisory locks, and record immutability. Publishing exempts a tool from none of it.

**There is no other write path in this plugin.** No palette command, no ribbon, no pane touches `app.vault`; the only vault writes are inside the seven handlers, which are only ever reached through the host. The move inside `promote_to_folder` goes through `app.fileManager.renameFile`, Obsidian's link-updating rename, never `vault.rename` — the host's own source scan can no longer see this code, so this package pins that guarantee itself in `tests/link-healing.test.mjs`.

What this plugin owns is the standard-zeros set and its frontmatter, the promote plan, the three reindex tiers and their description preservation, the template classification and placeholder engine, and the destination-path computation.

## The full ledger on the argument rename

**ACTED ON, in two rounds. Round 1 (2026-09-07):** the host added `note_path` to its path-key list, so for the two tools that name a note the three kernel checks below are LIVE again — record immutability refuses a `record: true` target, foreign lock claims are disclosed, and the journal carries the argument-derived target — and the allowlist scopes those two per-path, the standard host write-tool posture. The five that name no note stay pathless and F3 still refuses them wholesale. **Round 2 (2026-09-07), after an independent review:** round 1 held for this package (every tool here mutates), but it had also re-opened three READS elsewhere in the tier, so the rule was narrowed to **path-key iff the tool mutates the note it names** — and `reindex_category`'s unscoped sibling read was ratified as an accepted residual rather than quietly inherited. §2 above states it. **The ledger below is kept in full and is not obsolete:** it is the argument that made round 1 correct, and it is what anyone proposing to reverse either half has to answer.

**The rename costs more than allowlist availability, and the ledger has to be complete.** The host's path-key list is not the allowlist's private walker: the same list feeds three other kernel checks — record immutability (a mutating call that NAMES a note carrying `record: true` is refused before it runs), the advisory-lock consult (a foreign scope claim covering a named path is disclosed on the call), and the journal record's argument-derived target path. With no argument in the host's path-key list, all three see an empty path list on every call this plugin makes. So a `record: true` note is no longer protected from this plugin's writes by that check; a foreign claim covering the note is no longer disclosed; and the journal names no target path, mitigated only where a handler returns `filesChanged` / `files`, which the kernel records as the operation's effects. **None of those three is gated on an allowlist**, so they are lost in the ordinary, no-allowlist case too — the opposite direction from the tightening above, and not something to fold into it as if the change were strictly stricter. The record guard's own documented posture is already fail-open and "protective, not load-bearing", so this widens a gap that was open by design rather than closing one. It is still a real reduction, it is the strongest argument for reversing the rename, and the reversal is one word per tool.
