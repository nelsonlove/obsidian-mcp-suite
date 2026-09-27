# vault-mcp-api

Publisher SDK for [Governor](https://github.com/nelsonlove/obsidian-governor)'s external tool registry: let your Obsidian plugin publish MCP tools to Claude Code through Governor's bridge.

> **Canonical home moved (2026-08-19, #86):** this package now lives in the
> Governor monorepo at `packages/vault-mcp-api` of
> [nelsonlove/obsidian-governor](https://github.com/nelsonlove/obsidian-governor),
> next to the host side of the contract
> (`packages/host/src/mcp/external-tools.ts`) and a contract test that pins
> the two together. The old standalone repo
> ([nelsonlove/vault-mcp-api](https://github.com/nelsonlove/vault-mcp-api)) is
> to be archived; existing `github:nelsonlove/vault-mcp-api#v1.0.0` installs
> keep working from the archive. The published npm package name is unchanged.

> **Host renamed in 0.12.0, this package did not.** The host plugin's id moved
> `vault-mcp` → `governor` (and the product is now called Governor). The npm
> package name stays `vault-mcp-api` — it is a published contract, and renaming
> it would strand consumers for no user-visible gain. The SDK is **dual-id**:
> it looks the host up under `governor` first and falls back to `vault-mcp`,
> and it waits on both `governor:ready` and the legacy `vault-mcp:ready`. One
> SDK build therefore works against a host on either side of the migration.

## Install

    npm install vault-mcp-api

(Until the first monorepo-published version reaches npm, the pinned install from the old repo still works: `npm install github:nelsonlove/vault-mcp-api#v1.0.0`.)

`obsidian` and `zod` are peer dependencies (any plugin build already has the former; npm ≥7 auto-installs the latter).

## Use

    import { publishTools } from "vault-mcp-api";
    import { z } from "zod";

    // in your plugin's onload():
    this.register(
      publishTools(this, [{
        name: "my_tool",                 // published as <your-plugin-id>_my_tool
        description: "What it does.",
        inputSchema: { arg: z.string().describe("…") },  // or plain JSON Schema
        readOnly: false,                 // omit/false ⇒ blocked in Governor's read-only mode
        handler: async ({ arg }) => ({ result: "plain JSON out" }),
      }])
    );

Rules: tool `name` must match `/^[a-z][a-z0-9_]*$/`; published tool names must not collide with Governor's built-in `obsidian_*` namespace (registration throws a TypeError if the namespaced name would start with `obsidian_`). Handlers return plain JSON-serializable values (Governor wraps them) and thrown errors become MCP tool errors; tools appear to Claude Code sessions on their next connect. Requires a host whose `apiVersion` is at least 1 — the number is a floor, not an exact match, so a newer host is accepted and its extra members are detected by presence; a host below the floor (or with no version) gets a console warning and nothing is registered.

## Partial results (SDK 1.1, host apiVersion 2)

A handler that did part of its work returns `partial(data, message)` instead of throwing: the caller gets `data` AND the error bit. On a host at apiVersion 2 or later the result lands as `structuredContent = data`, the JSON plus the message as text, and `isError: true`; a thrown error stays text-only, as today. On a v1 host the branded object is wrapped as an ordinary result with the brand key (`vault-mcp-api/envelope`) visible: degraded, not broken. The brand is checked only on the top-level return value; a `partial` nested inside `data` is data.

    import { partial } from "vault-mcp-api";
    handler: async ({ paths }) => {
      const done = [], failed = [];
      // …
      return failed.length ? partial({ done }, `${failed.length} note(s) unreadable: ${failed.join(", ")}`) : { done };
    }

## Caller context (SDK 1.1, host apiVersion 2)

From apiVersion 2 the host passes a per-call `CallContext` as the handler's second argument: `visible(paths)` returns the subset this caller may see (the same array when no allowlist is active), `isVisible(path)` answers for one path, and `readOnly` says the session cannot write. The allowlist itself is never handed over. A v1 host passes nothing; treat absence as "cannot tell" and keep whatever filtering you do today, never as "everything is visible". What the context does not lift: a tool with no path argument under an active allowlist is still refused wholesale by the host; the context re-lights the row filters of the calls that get through.

    handler: async ({ folder }, ctx) => {
      const rows = await listRows(folder);
      return { rows: ctx ? ctx.visible(rows.map((r) => r.path)).map(lookup) : rows };
    }
