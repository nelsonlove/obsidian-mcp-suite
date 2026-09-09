# Governor — the governance provider

An Obsidian plugin that adds a human-only acceptance perimeter to the **Vault MCP** host. Install and enable `vault-mcp` first; on its own this plugin has nothing to govern.

The host gives you audited, journaled, allowlist-scoped agent access to your vault. This plugin turns that into *governed* access: every agent write becomes a proposal, and a human decides — in a review pane, by a real click — what counts.

## What it adds

- **A review pane.** Pending changes, their diffs, and the Accept / Revert / Request-changes / Adopt controls. Every one of them is a gesture-gated closure: never a command, never an MCP tool, never a method on anything reachable from `app`.
- **Proposals and admission.** Completed writes arrive as candidates with their exact base and proposed bytes recorded; admission verifies them against declared predicates and records the decision in a stock-git-readable standing chain.
- **Mandates.** Bounded delegation an agent can request and a human can grant — scope, change classes, named transformation, verification predicates, and hard budgets that stop rather than warn.
- **A local Git history** of your notes, off by default, at `~/.claude/governor/history/`, outside your vault and never synced.

## What it publishes

Five MCP tools, through `vault-mcp-api`, on the host's socket:

| Tool | Read-only | What it does |
|---|---|---|
| `governance_pending_review` | yes | What is waiting for human review. Advisory; it blocks nothing and it cannot accept. |
| `governance_revisions` | yes | Notes a human sent back for changes, with the request text parsed out of each note. |
| `governance_submit_revision` | no | Resubmit a revised note: back to `proposed`, addressed requests removed, optional report inserted. |
| `governance_mandate_draft` | no | Author a mandate REQUEST. A draft is a candidate; activation is a human gesture and has no tool. |
| `governance_mandates` | yes | The delegation landscape — drafts, mandates, usage against budgets. |

**There is no accept verb in any API**, and there never will be. Acceptance is a click in the pane.

Two things about how they behave under the host's guard, both stricter than they were when this code shipped inside the host:

- Their read-only claims are **distrusted** unless you add `governor` to the host's `trustedReadOnlyPlugins` setting. Until you do, the three read tools are blocked in read-only mode.
- Under an **active path allowlist** the host blocks any published tool whose arguments carry no path it recognizes. Four of the five carry none, so they are unavailable while an allowlist is set; only `governance_submit_revision` (which takes `path`) stays available, scoped to the note you name.

## Install

Copy `main.js` and `manifest.json` into `<vault>/.obsidian/plugins/governor/` and enable it in Obsidian's community-plugin settings. **Enable the Vault MCP host first** — this plugin derives its review queue from the host's write journal, and with no host loaded the pane refuses to mount and tells you so.

If you are upgrading from the single-plugin build (0.18.x, plugin id `governor`), read `docs/s3c-migration-plan.md` at the repository root before you start. Short version: this plugin keeps the folder and every byte of `governance/`; the host installs beside it under the id `vault-mcp` and copies out the write journal and its own settings without moving or deleting anything. There is a tested rollback path.

## Build

```
npm run build     # esbuild → main.js
npm test          # tsc --noEmit && node --import tsx --test
```

The bridge is the host's and is not built here. `npm test` rebuilds `@vault-mcp/core` first, which is load-bearing rather than tidy: the tests reach several published contracts through the compiled output.

Working notes, and every locked decision, are in `CLAUDE.md`.
