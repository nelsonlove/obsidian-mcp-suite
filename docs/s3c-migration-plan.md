# S3c migration plan — one plugin becomes two, on a live vault

> [!warning] BUILT, NOT YET CUT OVER
> Nothing in this document has been run against the operator's vault. The code is on the branch, both plugins build, and every suite is green headlessly. The cutover is a human act with a rollback path, described below. [Status and compatibility](status-and-compatibility.md#current-release-state) remains the single owner of shipped truth.

This is the S3 package's required migration map ([the suite split's §4](suite-split-design.md), "the migration plan in the S3 package names every file and where it lands"). It names every piece of state the pre-split plugin owns, says who owns it after the split, and says what — if anything — moves.

## 0. The shape of the answer, in one paragraph

**Almost nothing moves.** The governance provider keeps the plugin id `governor`, so it keeps the folder `.obsidian/plugins/governor/` and everything under `governance/`, and it keeps the machine-local directory `~/.claude/governor/` where the standing chain lives. The HOST takes back the id `vault-mcp`, installs into a new folder, and **copies** three things out of the provider's folder on its first load: the write journal, the install id, and its own half of `data.json`. It never moves and never deletes, and it never writes into the provider's folder at all. On the machine-local side the host's namespace returns to `~/.claude/vault-mcp/` while `~/.claude/governor/` keeps a grace-period bridge and a `legacy: true` discovery copy, so **every existing `claude mcp` registration keeps working with no re-registration**.

## 1. Every file, and where it lands

### In the vault: `.obsidian/plugins/governor/`

| Path | Owner after S3c | What happens |
|---|---|---|
| `main.js`, `manifest.json`, `styles.css` | PROVIDER | replaced by the provider's own build. Never adopted by the host — `CODE_ARTIFACTS` excludes them structurally. |
| `data.json` | **SHARED FILE, split ownership** | Stays. The provider reads its own keys from it and **merges on save**, never replacing. The host **copies** its half out once (`splitSettings` in `@vault-mcp/core`) into `.obsidian/plugins/vault-mcp/data.json`. Neither plugin ever deletes the other's keys. |
| `journal/YYYY-MM.jsonl` | HOST | **COPIED** to `.obsidian/plugins/vault-mcp/journal/`. The originals stay. See §3 for why copy and not move. |
| `install-id.json` | HOST | **COPIED**. The original stays. Copying rather than re-minting keeps `actor.server.install` continuous across the split, so the audit stream does not report a new install. |
| `governance/baselines/**` | PROVIDER | **UNTOUCHED.** Not read, not copied, not listed. |
| `governance/acceptance-log.jsonl` | PROVIDER | untouched |
| `governance/pending-index.json` | PROVIDER | untouched. Written by the review pane, read by the provider's own `governance_pending_review` — both in the same plugin now. |
| `governance/proposals.jsonl` | PROVIDER | untouched |
| `governance/mandates.jsonl` | PROVIDER | untouched |
| `governance/sessions.jsonl` | PROVIDER | untouched — see §4, the session split. |
| `governance/admission-claims.jsonl` | PROVIDER | untouched |
| `governance/promotion-evidence.jsonl` | PROVIDER | untouched |
| `governance/cutover.json` | PROVIDER | **UNTOUCHED.** This is the authority cutover marker, bound to the machine holding the chain. Moving it is the single most dangerous operation in this whole area, and the split does not perform it. |
| `governance/legacy-evidence.jsonl` | PROVIDER | untouched |
| `governance/auto-accept-allowlist.json` | PROVIDER | untouched |
| `governance/rename-records.json` | PROVIDER | untouched |
| `governance/quarantine/**` | PROVIDER | untouched |
| `crosssession-receipts.json` | already the `vault-crosssession` satellite's | untouched by both. That satellite adopted it by merge at S6 and its copy is authoritative; a second adoption here would resurrect a stale read position. |
| `MIGRATED.md` | inert | The 0.12.0 marker, left in `plugins/vault-mcp/` by the previous migration. Harmless; the host installs over that folder and recognizes the marker. |

### On the machine: `~/.claude/`

| Path | Owner after S3c | What happens |
|---|---|---|
| `~/.claude/vault-mcp/bridge.mjs` | HOST | **PRIMARY again.** Written on every load from the build-time-embedded source. |
| `~/.claude/vault-mcp/<vault-slug>.sock` | HOST | the live socket |
| `~/.claude/vault-mcp/<vault-slug>.json` | HOST | canonical discovery |
| `~/.claude/vault-mcp/observations/<vault-slug>/` | HOST | new writes land here |
| `~/.claude/governor/bridge.mjs` | HOST (grace copy) | still written, same bytes. **This is what keeps existing registrations working**: `claude mcp` entries point `node` at this path. |
| `~/.claude/governor/<vault-slug>.json` | HOST (grace copy) | `legacy: true`, `socket_path` pointing at the NEW socket. Bridges skip `legacy` duplicates when merging the two directories. |
| `~/.claude/governor/observations/<vault-slug>/` | HOST (read-only residue) | **NOT MOVED.** The blob store falls back to it on a read miss and never writes or prunes it, so a payload recorded before the split is still replayable. A human clears it when the old payloads are spent. |
| `~/.claude/governor/history/<vault-slug>/` | **PROVIDER** | **UNTOUCHED.** The standing chain's git directory. It stays because the provider kept the id `governor` — this is the single biggest reason the provider kept it. |
| `~/.claude/governor/history/<vault-slug>/governor-store-id.json` | PROVIDER | untouched. The store identity the cutover marker names. Moving it would make a bound marker read as "cut over elsewhere; chain absent here". |

**The two plugins share `~/.claude/governor/` and write disjoint names** — the host's grace-period bridge and legacy discovery copy beside the provider's `history/` repository. Nothing in the suite ever removes that directory wholesale, and nothing should.

## 2. What is NOT a migration, but is a behaviour change on the operator's vault

- **The MCP server name stays `governor`.** Tool prefixes remain `mcp__governor__*`. The Obsidian plugin id changed; the Claude Code registration name did not, because the client-visible tool prefix is a shipped name and renaming shipped names breaks agent sessions for zero semantic gain. An operator's `~/.claude/settings.json` permission entries keep working untouched.
- **Four governance tools keep their exact names, and ONE was renamed.** The published set is `governance_pending_review`, `governance_revisions`, `governance_submit_revision`, `governance_mandate_draft`, `governance_mandates` — all bare, through a closed grandfather table in the host (`GRANDFATHERED_TOOL_NAMES`) that carves out the `<plugin id>_<bare name>` prefixing rule and nothing else. **`obsidian_pending_review` became `governance_pending_review`** (Nelson's ruling, 2026-09-08): grandfathering the old spelling would also have carved out F1, the host's refusal of any published name beginning `obsidian_`, and an exception to a namespace-integrity rule becomes the precedent for the next exception. The rename also has real semantic gain — the `obsidian_` prefix branded a governance tool as a host built-in, which after the split is an architectural lie.
  - **What an operator has to do about it: nothing, in practice.** MCP tools are discovered per session, so any session that reconnects after the cutover sees the new name. The one glob in the repository that patterns on it (`packages/host/cc-plugin/hooks/scripts/block-record-writes.sh`'s `*pending_review*`) still matches. A hand-written permission entry naming the exact old string would stop matching; check `~/.claude/settings.json` if you have one.
- **Their allowlist posture got STRICTER**, exactly like every previous extraction. As external tools their read-only claims are distrusted unless the operator adds `governor` to `trustedReadOnlyPlugins`, and under an ACTIVE path allowlist the F3 gate blocks any external tool carrying no recognized path key — so four of the five are refused wholesale while an allowlist is active. Only `governance_submit_revision` (which takes `path`) stays scoped per-path. **This operator's allowlist is empty**, so the live effect today is limited to read-only mode.
- **`governance_mandate_draft` now REQUIRES `delegate`.** A published tool does not learn which connection is calling, so a draft that omits it is refused `no_session` instead of defaulting to the caller's own session. The proper close is the apiVersion-2 item that carries caller scope to a publisher.
- **The host's module registry declares ONE built-in module (`scheme`).** A surviving `modules.acceptance` row in either `data.json` is an unknown id: reported by skip-and-report, never mounted. The row stays in the file deliberately — it is the provider's adoption source and part of the rollback path.

## 3. COPY, not MOVE — and why the journal decided it

The 0.12.0 migration MOVED, and was right to: one plugin was being renamed, and it owned every file in the folder. S3c is the opposite situation with the same directories, because the source folder is now a **live plugin's own directory**.

For the two host-owned entries the real question was still open, and the journal settled it.

- **A MOVE** leaves the reverted single-plugin build looking at an EMPTY `journal/`. That reads as "this vault has no write history" — the silent-zero class, on the one file that is append-only evidence. It is not recoverable from inside the product: the pending review queue is DERIVED from the journal, so an empty journal is also an empty review queue with nothing saying why.
- **A COPY** leaves the pre-split history complete and in place. Its cost is a documented DIVERGENCE: writes after the split land in the host's copy alone, so a rollback resumes from the split moment and the post-split months live in `plugins/vault-mcp/journal/` until a human reconciles them. Records are timestamped and `corrects`-chained, so reconciling is a concatenation, not a forensic exercise.

Divergence is reconcilable; an empty journal is not. **Copy wins**, and the `ADOPTED-FROM-GOVERNOR.md` record the host writes in its own folder names exactly what was copied, when, and where the originals still are.

The same reasoning made the adoption surface structural rather than advisory: `AdoptionFs` (`packages/host/src/id-migration.ts`) has **no `rename` and no `remove`**. The host cannot move or delete the provider's state, and a future author who wants to has to widen the interface first — which is a line in a diff.

## 4. The session split (condition 7), stated because it changes a durable file's meaning

[Condition 7](suite-split-design.md#amendments-from-the-independent-perimeter-review-2026-08-27--s2s-acceptance-criteria) ruled that the HOST mints — a session is transport state — and named what the host keeps: "identifiers, scope digest, lifecycle". It also ruled that **the seam carries no connection-lifecycle notification**, because the provider never mints. S3c builds exactly that, and no new seam surface was added.

- The **HOST** now writes its own append-only lifecycle log at `.obsidian/plugins/vault-mcp/sessions.jsonl` (`opened` / `closed` / `expired`). It is EVIDENCE — there is deliberately no `get`, because reading the durable record to decide whether a queued mutation may proceed is asking permission, and the host asks nobody. Expiry is its own pure floor, which needs no store and no provider.
- The **PROVIDER** keeps `governance/sessions.jsonl` exactly where it is, and keeps writing the same event shapes. What changed is that it no longer witnesses `opened`, so its two surviving questions — is this session revoked, and what mandate is bound to it — are folded by ID rather than reconstructed from a record (`foldSessionAuthority`). `foldSessionEvents` is unchanged, so every historical line in that file still folds exactly as before.

**The cost, named:** `revoke` and `attachMandate` no longer verify that the session is open. Revocation is safe by construction — it can only ADD a refusal, and a revoked id nobody is using refuses nothing. Mandate attachment is safe on the provider's own prior ruling that fit binds by session id and the record "is provenance, not a gate". What is genuinely lost is the refusal of a mandate attach to an already-expired session, which surfaced as a `sessionAttachWarning` and never undid the grant. **Flagged for ratification**, because condition 7's sentence "the seam carries no connection-lifecycle notification" was written without `attachMandate` in view.

## 5. THE LIVE PROCEDURE

Do this with Obsidian closed between steps where it says so. Nothing here is reversible-by-accident; every step is reversible on purpose.

1. **Verify the backup is fresh.** The `obsidian-backup` tickle job commits `~/obsidian` to `~/obsidian-backup.git`; the standing chain has its own backup repository (#337). Confirm both are current before anything else. The chain backup is the one that matters — it is the only copy of `~/.claude/governor/history/`.
2. **Note the current state**, so the after can be compared to the before: the newest journal month and its line count, `governance/cutover.json`'s contents, the output of `claude mcp get governor`, and whether the review pane is currently enabled.
3. **Close Obsidian.**
4. **Install the PROVIDER over the existing folder.** Copy `packages/governor/main.js` and `packages/governor/manifest.json` into `.obsidian/plugins/governor/`. This replaces the code and touches no data. The folder keeps its `governance/`, its `data.json`, its `journal/` and its `install-id.json`.
5. **Install the HOST into its own folder.** Create `.obsidian/plugins/vault-mcp/` if it does not exist (on this vault it does, carrying the 0.12.0 `MIGRATED.md` and stale code), and copy `packages/host/main.js` and `packages/host/manifest.json` in. **Do not copy any data by hand** — the adoption is the plugin's job and it is latched on the absence of `data.json`.
6. **Open Obsidian and enable "Vault MCP" first.** It will run the one-shot adoption. Watch for a sticky Notice: every non-success outcome raises one, because a silent skip means the host is running at DEFAULTS — socket enabled, read-only OFF, allowlist EMPTY.
7. **Verify the adoption before doing anything else** (§6's checklist).
8. **Enable "Governor".** It reads its settings out of the same `data.json` it always did.
9. **Re-enable the review pane** in Governor's own settings tab if it was on. It is a different toggle in a different place now.
10. **Reconnect any open Claude Code session.** The socket path changed, but the registration did not: the bridge at `~/.claude/governor/bridge.mjs` is rewritten on load and resolves the new socket through the `legacy: true` discovery copy. A session that was connected before the reload must reconnect regardless, because each connection is a fresh server.

## 6. Verification, after the cutover

**Adoption:**
- `.obsidian/plugins/vault-mcp/ADOPTED-FROM-GOVERNOR.md` exists and names `journal` and `install-id.json`.
- `.obsidian/plugins/vault-mcp/journal/` holds the same months as `.obsidian/plugins/governor/journal/`, with the same line counts.
- `.obsidian/plugins/vault-mcp/install-id.json` matches the provider folder's.
- `.obsidian/plugins/vault-mcp/data.json` carries the allowlist, `readOnly`, `schemes`, `cliPolicy` and `protectedProperties` the pre-split plugin had, and does NOT carry `historyEnabled` or `historyScope`.
- `.obsidian/plugins/governor/` is **byte-identical** under `governance/` to what step 2 recorded.

**Transport:**
- `obsidian_environment_info` (or the diagnostics command) reports the new version and names the registered governance provider.
- A write lands a record in the HOST's journal, not the provider's.

**Governance:**
- `governance_pending_review` returns `published: true` with the same queue the pane shows. If it returns `published: false`, the provider's `journalDir` is wrong — that is the failure this split most plausibly introduces, and the pane refuses to mount at all when no host is loaded precisely to make it loud.
- `governance_revisions`, `governance_mandates`, `governance_mandate_draft` and `governance_submit_revision` are all present under their exact names — **not** `governor_governance_*`.
- The review pane opens, and its Accept control still refuses correctly post-cutover (`legacy_writer_disabled`).

## 7. THE ROLLBACK PATH

The whole design of §1 and §3 exists to make this short.

1. Close Obsidian.
2. Disable both plugins (`.obsidian/community-plugins.json`, or Obsidian's own settings before closing).
3. Reinstall the pre-split single-plugin build's `main.js` + `manifest.json` (id `governor`, version 0.18.2) into `.obsidian/plugins/governor/`.
4. Open Obsidian and enable it.

**It finds everything where it left it.** Its `data.json` still has every key it ever wrote — the provider merges rather than replaces, and the host never wrote into that folder. Its `journal/` is intact up to the moment of the split. Its `install-id.json` is unchanged. Its whole `governance/` tree, the cutover marker and the store binding were never touched. `~/.claude/governor/history/` was never touched. The bridge at `~/.claude/governor/bridge.mjs` is what the old build writes anyway, and the registration name never changed.

**What it does NOT have** is anything written after the split: journal records that landed in `plugins/vault-mcp/journal/`, and any session lifecycle lines in `plugins/vault-mcp/sessions.jsonl`. Both are append-only and timestamped; reconciling is concatenating the newer months back in, and the `ADOPTED-FROM-GOVERNOR.md` record says exactly which files to look at.

**Optional cleanup after a rollback:** delete `.obsidian/plugins/vault-mcp/` (its journal months should be reconciled first) and `~/.claude/vault-mcp/`. Do **not** delete `~/.claude/governor/` — the standing chain's history repository is in it, alongside the grace-period bridge.

## 8. What cannot be verified headlessly — the LIVE CHECKLIST

Every item below is a claim this package makes that no test in this repository can reach. They need a running Obsidian.

**The adoption itself.** `runHostAdoption` is unit-tested against a fake `AdoptionFs`, which is not Obsidian's `DataAdapter`. The structural claim (no rename, no remove) holds by types; the behavioural claim that Obsidian's adapter satisfies the surface, that a `list` of `journal/` returns what the copy walker expects, and that the copy of a multi-megabyte JSONL month completes inside a plugin load, do not.

- [ ] The host loads and the sticky-Notice path does NOT fire.
- [ ] The journal copy is byte-identical, month for month.
- [ ] The provider's folder is unchanged (`git status` on a vault snapshot, or a directory hash before and after).

**The seam across two plugins.** Every seam mechanic is pinned in-process (`packages/host/tests/seam.test.mjs`), and the SDK's registration path is pinned against the host's shapes (`packages/vault-mcp-api/tests/contract.test.ts`). What is NOT reachable is the actual cross-plugin round trip: two Obsidian plugin instances, one registering on the other's `api` object.

- [ ] With both plugins enabled, an MCP write produces a proposal in `governance/proposals.jsonl`.
- [ ] Disabling the provider mid-session leaves the host fully functional (writes land, journal records, no errors), which is the standalone-host claim.
- [ ] Re-enabling the provider re-registers: `registerGovernance` must pick the host up again on the ready event, and a second write must propose again.
- [ ] `obsidian_plugin_toggle('governor', false)` is REFUSED while the provider holds a registration, and the refusal names it as a registered governance provider (condition 6).
- [ ] `obsidian_plugin_uninstall('governor')` is refused for the same reason.

**Published tool names.** The grandfather table is unit-tested; that the SDK actually publishes these five specs into the host's registry under those exact names, in a live renderer with two bundles, is not.

- [ ] `tools/list` on a fresh connection contains all five, unprefixed.
- [ ] None of them appears as `governor_governance_*`.

**Load order.** `publishTools` and `registerGovernance` both handle "the host may load later" through the ready event, and the host fires `vault-mcp:ready` and `governor:ready`. Untestable headlessly.

- [ ] Provider enabled BEFORE host: tools appear after the host loads.
- [ ] Host reloaded while the provider stays loaded: tools reappear, and the seam hooks re-register into the NEW seam rather than holding the dead one.

**Settings ordering.** The merge-on-save rule (§1, `data.json`) is the fix for a race no headless test can produce: the provider saving before the host has adopted.

- [ ] Enable the provider FIRST, change a setting in its tab, THEN enable the host, and confirm the host still adopts a complete allowlist.

**The review queue's journal directory.** The provider derives the queue from the host's journal directory, resolved from the host plugin's `manifest.dir`.

- [ ] The pane shows the same pending set it showed before the split.
- [ ] With the host disabled, enabling the pane refuses with the explanatory Notice rather than showing an empty queue.

**The review queue's event drive (#261), which got narrower.** The host used to nudge the queue from inside its `journal.append` wrapper — every append. It cannot now; the provider nudges from the seam's write observer instead, which fires only where write facts were produced. The property that matters is unchanged in kind and reduced in scope, and only a live window can show it.

- [ ] With the Obsidian window OCCLUDED (another app in front, Obsidian not focused), an agent MCP note-write surfaces in the review pane without waiting for the poll.
- [ ] A mutating operation that is NOT a native note-write (a move, a repoint) does not — it waits for the interval. Confirm that this is acceptable, or open the journal-growth-hook conversation.

**Observation replay across the directory move.** The blob store's read fallback is unit-testable in principle but the live claim is about a real directory.

- [ ] A payload recorded before the split still replays. (Capture is default-off on this vault, so this may be vacuous — confirm which.)

**The gesture perimeter after the split.** The source tripwires still hold, but the live reachability walk is the definitive proof and it needs a renderer.

- [ ] From the developer console, `app.plugins.plugins['governor']` exposes no accept-capable function, and neither does `app.plugins.plugins['vault-mcp']`.
- [ ] `app.plugins.plugins['vault-mcp'].api` offers `registerTools`, `registerWriteObserver` and `registerSessionRefusal` and nothing else.

## 9. Release tooling — the gap this package inherits and does not fully close

§9 of the split design names release multiplication as a cost: "one release lane becomes several manifests… the S3 package must include per-plugin release tooling, not inherit the gap." **This package does not close it.** Both plugins build with their own `npm run build` and carry their own `manifest.json` and version, and `packages/host/versions.json` gained its `0.19.0` row — but the repository's release workflow still assumes one plugin artifact. That is named here as an open item rather than claimed done, and it does not block the cutover, because the cutover is a hand-installed build.
