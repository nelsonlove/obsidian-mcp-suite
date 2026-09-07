# Vault Fileclass (plugin id `vault-fileclass`)

Typed frontmatter, given an agent surface: list the vault's fileClasses, read a class schema with its inherited fields, explain a note, query rows, and write validated field values — by proxying the standalone [`fileclass` CLI](https://github.com/mdelobelle/fileclass-cli), the plugin author's own terminal for the Fileclass Obsidian plugin. Like the triage, cross-session and bases satellites and unlike the skills one, this plugin has no human surface at all — no pane, no palette command, no ribbon. Its entire surface is eight MCP tools published to the Governor host through `vault-mcp-api`, plus a settings tab for the one thing a human tunes: where the CLI binary lives.

## Lineage

Built as the host's `fileclass` capability module (#188). Extracted to its own plugin at the suite split's mutating tier — the design doc's `docs/suite-split-design.md` §6 row *"Fileclass CLI proxy | public optional | satellite"*. It follows `packages/quickadd-choices-compile` (the pilot), the private-tier satellites `packages/skills` (S4), `packages/triage` (S5) and `packages/crosssession` (S6), and the read tier `packages/vocab` / `packages/health` / `packages/bases` (S7). The proxy design, the argv construction, the double gate and the accept guard are the same code through both homes; only who mounts them differs.

## Package layout

```text
packages/fileclass/
├── manifest.json          plugin id `vault-fileclass`, isDesktopOnly
├── esbuild.config.mjs     bundles src/main.ts → main.js (no assets, no defines)
├── src/
│   ├── main.ts            onload: settings + adoption, settings tab, publishTools (re-published on every config change)
│   ├── settings.ts        settings shape, the 1 field definition, the config validator, one-shot host config adoption (pure)
│   ├── settings-tab.ts    the plugin's own settings tab — and the three silences
│   ├── tools.ts           the eight tool specs, argv construction, the exec seam, the accept guard, the dormant allowlist seam
│   └── obsidian-source.ts the live adapter — two questions about the running app, nothing more
└── tests/                 58 tests; everything but the Obsidian adapter is headless
```

There is no `src/kernel/`. Unlike every other satellite, this surface has no pure rule core to move: the engine is the `fileclass` CLI's, and what this package owns is argv construction, `--json` parsing, the accept refusal and the gates — which live in `tools.ts` beside the specs they belong to.

Installed into a vault this is two files — `main.js` and `manifest.json` — plus, during development, an empty `.hotreload` marker in the installed plugin directory so the hot-reload plugin picks up rebuilds. The `.hotreload` file lives in the vault install, never in this repo.

## Build and test

```bash
npm run build          # esbuild → main.js
npm test               # tsc --noEmit && node --test 'tests/*.test.mjs'
```

`pretest` rebuilds `@vault-mcp/core` first, for the same reason the host's and the other satellites' do: the tests reach published core contracts (`isVisible`, and through `tools.ts` the accept rule, `spawnEnv` and `findBinary`) via `packages/core/dist` — the COMPILED output. Without the rebuild you are testing the previous build's bytes.

## It needs the host — and two more things besides

Three distinct silences, one more than any other satellite has. The settings tab names whichever one applies rather than leaving you to guess:

1. **Governor absent.** The eight published tools ARE the plugin. With no host it loads, keeps and validates its settings, and does nothing; `publishTools` waits on the host's ready event and registers the moment a host appears.
2. **The Fileclass plugin not loaded.** This is a proxy; with no engine there is nothing to proxy. The gate reads `app.plugins.plugins.fileclass` — the LOADED instance, never `app.plugins.enabledPlugins`, which can carry a configured-but-uninstalled plugin as a stale entry.
3. **The `fileclass` CLI binary not found.** Probed on the standard install paths (`/usr/local/bin`, `/opt/homebrew/bin`, `~/.local/bin`, `~/.npm-global/bin`, `/usr/bin`), or set explicitly in the settings tab.

In each case the plugin publishes *nothing*: absent, not broken. **The grain of that check changed at the extraction and it is worth knowing.** As a module the gate ran per connection build, so a session that reconnected after installing the plugin or the binary got the tools. As a satellite it runs at publish time — plugin load, and every settings write. So installing either without reloading this plugin (or touching a setting) leaves the tools absent until a reload. Same caveat the bases satellite carries, same reason.

## The four things the extraction changed

### 1. The published tool names changed — twice over

| shipped by the module | bare name in this package | published by the satellite |
|---|---|---|
| `fileclass_list` | `list` | **`vault_fileclass_list`** |
| `fileclass_schema` | `schema` | **`vault_fileclass_schema`** |
| `fileclass_explain` | `explain` | **`vault_fileclass_explain`** |
| `fileclass_query` | `query` | **`vault_fileclass_query`** |
| `fileclass_get` | `get` | **`vault_fileclass_get`** |
| `fileclass_validate` | `validate` | **`vault_fileclass_validate`** |
| `fileclass_set` | `set` | **`vault_fileclass_set`** |
| `fileclass_set_where` | `set_where` | **`vault_fileclass_set_where`** |

Two compositions produce that, exactly as with bases. First, the host publishes an external tool as `<sanitized publisher id>_<bare name>`, so **the plugin id and the tool namespace are the same string**, and `vault-fileclass` sanitizes to `vault_fileclass`. Second, the bare names shed their `fileclass_` prefix, because keeping them would have published the stuttering `vault_fileclass_fileclass_list`.

**This breaks any agent session or saved prompt that calls the old names.** That cost is real and should not be understated: the host's own locked decision says renaming shipped tool names breaks agent sessions for zero semantic gain. What buys it here is that the alternative spelling is actively worse to read and to type, and that the rename is one motion rather than two.

**Reversing it is a one-line change**: `manifest.json`'s `id`, plus the strings in `tests/host-shim.mjs` and the settings tab's status line. Nothing else in the package encodes the prefix — the specs carry BARE names, and the prefix is the host's.

Note one collision that is not a collision: the host has always shipped `obsidian_fileclass_schema` and `obsidian_fileclass_insert_fields` for the **metadata-menu** plugin. Different plugin, different spelling, untouched by this extraction.

### 2. An argument was renamed, and that is the whole allowlist posture

**`path` → `note_path`, on `explain`, `get` and `set`.**

The module refused its **whole surface** while a path allowlist was active: the fileclass CLI runs over the entire vault through its engine and its output cannot be attributed to paths, so a scoped answer was not expressible (the `obsidian_cli` / Dataview precedent). That refusal ran in-module, over the host's guard settings. **A satellite cannot see the host's allowlist**, so that check goes dormant — and the question becomes what the host enforces in its place.

The host's gate is evaluated **at call time on the ACTUAL ARGUMENTS**: a mutating external tool whose arguments carry no recognized path key is blocked outright while a path allowlist is active. (Every external tool is mutating unless its publisher's raw id appears in the host's `trustedReadOnlyPlugins` setting — and since 2026-09-05 trust answers read-only mode only, never scoping.) So the posture is decided entirely by whether the argument is named `path`.

Keeping `path` would have left `explain` / `get` / `set` **open** under an allowlist, scoped per-path by the host, while the other five stayed blocked. That is strictly weaker than the module's refuse-all, and weaker in the direction that matters: the host would scope the note *named*, while the CLI still runs its engine over the whole vault and returns whatever that engine attributes to the note — including inheritance from fileClass definitions the session cannot see, and, for `set`, a write performed through the live plugin rather than through any path the guard inspected.

So the argument is named `note_path`, which is not one of the host's path keys. **All eight tools are therefore blocked wholesale under an active allowlist** — the module's own refusal, reproduced by the boundary instead of by a check this package can no longer make. Fail-closed, and identical in effect to what shipped before.

**The reversal is one word**: rename the argument back to `path` and the host will scope those three tools per-path instead. Do that only with the paragraph above answered.

**RESOLVED at S8's review — the host recognizes `note_path` now.** The paragraph below records the ledger as it stood when the argument was pathless; it is kept because the reasoning is the reversal-decision record. Since the review, `note_path` is on the host's path-key list, so for every tool that names a note the three kernel checks are LIVE again — record immutability refuses a `record: true` target, foreign lock claims are disclosed, and the journal carries the argument-derived target — and the allowlist scopes those tools per-path (the standard host write-tool posture). Tools with no named note stay pathless, so F3 still refuses them wholesale under an allowlist. The trade the paragraph below weighs no longer has to be made.

**The rename costs more than allowlist availability, and the ledger has to be complete.** The host's path-key list is not the allowlist's private walker: the same list feeds three other kernel checks — record immutability (a mutating call that NAMES a note carrying `record: true` is refused before it runs), the advisory-lock consult (a foreign scope claim covering a named path is disclosed on the call), and the journal record's argument-derived target path. With no argument in the host's path-key list, all three see an empty path list on every call this plugin makes. So a `record: true` note is no longer protected from this plugin's writes by that check; a foreign claim covering the note is no longer disclosed; and the journal names no target path, mitigated only where a handler returns `filesChanged` / `files`, which the kernel records as the operation's effects. **None of those three is gated on an allowlist**, so they are lost in the ordinary, no-allowlist case too — the opposite direction from the tightening above, and not something to fold into it as if the change were strictly stricter. The record guard's own documented posture is already fail-open and "protective, not load-bearing", so this widens a gap that was open by design rather than closing one. It is still a real reduction, it is the strongest argument for reversing the rename, and the reversal is one word per tool.


With **no allowlist configured** — the ordinary case — nothing changes at all.

The in-handler `allowlistRefusal` is kept as a **dormant seam** over `ctx.getSettings`, the posture the skills, triage, cross-session and bases satellites all keep: nothing supplies it in the shipped configuration, its tests supply it so it cannot rot, and a `vault-mcp-api` that can carry the caller's scope to a publisher (an apiVersion-2 item) makes it live again with no code change.

### 3. One envelope changed: read `succeeded`, not the error flag

The module used the host's `okError()` for a failed CLI run — `ok()`'s shape plus `isError: true` — so the structured per-command report survived a total failure, where a bare `fail()` would have flattened it to text.

**The publishing boundary has no `okError`.** A returned object becomes `ok(data)`; a thrown error becomes `fail(err)`; there is no third option. Throwing would destroy the report, which is the thing `okError` existed to preserve. So a failed CLI run **returns** its report, with an explicit `succeeded: false` beside the exit code, stderr and argv.

The consequence, stated plainly because a client keying on `isError` will meet it: **a fileclass CLI failure now arrives as a successful MCP call carrying a report that says it failed.** Every tool description says so, and a test pins it.

Everything else is byte-compatible with the folded era: `accept_forbidden` and `out_of_allowlist` render as `Error [code]: message` exactly as `codedError` produced them. Three refusal codes are **new**, all of them argument validation the JSON-Schema round trip no longer carries: `invalid_argument` (a missing/blank required string, an out-of-range `timeout_ms`, a non-positive `limit`, a `value` that is not string/number/boolean) and `invalid_path` (a backslash in `note_path`).

### 4. Settings adopt once from the host, and never write back

Configuration used to live in the host's `data.json` at `modules.fileclass.config` — one key, `binaryPath`. On first load this plugin copies it into its own `data.json` and latches, under the three rules the earlier satellites established: **it never writes the host's settings**, **it runs once**, and **this plugin's own value wins** (adoption fills gaps only). If the host is absent — or present but still mid-`onload`, with `settings` undefined — nothing is adopted and the latch is not set, so the one chance survives to a later load. **A failed persist also holds the latch open**, implemented rather than merely promised: the in-memory latch is only accepted after `saveData` resolves. That is the cross-session review's lesson, and a test drives the exact sequence.

Blank is not a missing setting — it is the documented "auto-detect on the standard install paths" value. What makes the migration worth doing is the non-blank case: a user who set `binaryPath` did so *because* the probe did not find their binary, so losing it means the plugin publishes nothing and reads as "the fileclass tools are gone".

**There is no second adoption, and that is a checked fact rather than an omission.** Cross-session needed one because it had live operational state outside `data.json` (its per-handle read receipts). This surface is a subprocess proxy end to end: no state file, no cache across calls, nothing it ever wrote anywhere but that one config key. Pinned by a test over `DEFAULT_PLUGIN_SETTINGS`' key set.

## Two smaller consequences worth knowing

**Refusals throw.** A handler returns plain data or throws; the host wraps the first in `ok()` and the second in `fail()`, and `fail()` renders a lowercase-snake `code` off the error as `Error [code]: message`. `ok` / `fail` / `codedError` / `okError` are host-internal and are not imported here.

**Schema bounds are re-applied in the handler.** The SDK converts a zod shape to JSON Schema and the host converts it back through a deliberately small subset: `type`, `description` and string `enum` survive; `default`, `min`, `max` and `pattern` do not. So every `.min(1)`, the `timeout_ms` range, `limit`'s `.int().min(1)` and `value`'s union all run again in the handler, where they actually execute. This is the `vault_skills_release` semver lesson, applied before it could bite.

## What the host still owns

Everything a published tool rides through: the guarded registration point, read-only mode, the path allowlist, the serialized write queue, the write journal, `if_rev` / `idempotency_key` / `intent`, advisory locks, and record immutability. Publishing does not exempt a tool from any of it — which is also why an untrusted read-only claim costs the six read tools a queue slot and a journal record apiece.

**Acceptance stays where it always was.** `set` and `set_where` route through `acceptForbiddenReason` from `@vault-mcp/core` — the same rule the vault write primitive and the `obsidian_cli` `property:set` path use, with no second definition of "accepted" — applied *before* the CLI runs, over the `{ [field]: value }` the call would write. A fileclass field-write can never introduce or change `accepted` / `accepted-by` / `accepted-on`, nor set `acceptance-status` to an accepted value. That rule was already core's, so the extraction did not move it and could not weaken it.

What this plugin owns is the argv construction (with the vault pinned via `--vault`, so a session can never cross into another vault), the `--json` parsing, the double gate, the accept refusal on the field-write path, and its own settings.
