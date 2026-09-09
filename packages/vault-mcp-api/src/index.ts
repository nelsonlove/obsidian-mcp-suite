// src/index.ts
import type { Plugin } from "obsidian";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// ── Boundary types (mirror packages/host/src/mcp/external-tools.ts) ────────

export interface JsonSchemaObject {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
}

export interface ExternalToolSpec {
  name: string;
  description: string;
  inputSchema?: JsonSchemaObject;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

/**
 * The host's tool-publishing api, mirrored from
 * packages/host/src/mcp/external-tools.ts and pinned against it by
 * tests/contract.test.ts.
 *
 * `unregisterTools(ownerPluginId)` was REMOVED from both sides by S2 of the
 * suite split: it was addressed by owner id, so any caller holding the api
 * object could revoke any publisher's tools. The disposer `registerTools`
 * returns is now the only revocation path — which is what `publishTools` below
 * has always used, so nothing in this SDK changes behaviour. `apiVersion` stays
 * 1: the host removed a method it never needed to offer and added the
 * governance seam beside it, and neither changes what a publisher sends.
 */
export interface VaultMcpApi {
  apiVersion: 1;
  registerTools(ownerPluginId: string, tools: ExternalToolSpec[]): () => void;
}

// ── The governance seam (mirrors packages/host/src/mcp/seam.ts) ───────────────
//
// The host's hook API for an OPTIONAL governance provider. It ships on the same
// `plugin.api` object `registerTools` does — `apiVersion` stays 1 because the
// methods are additive, and a bump would make every published build of this SDK
// refuse to register.
//
// TWO HOOK CLASSES, AND THERE WILL NEVER BE A THIRD. `registerWriteObserver` is
// post-write and observe-only (the host ignores the return value);
// `registerSessionRefusal` is consulted at dequeue and returns `{code, detail}`
// or `null`. `null` is SILENCE, not an allow — the type cannot express
// permission, so a registrant can never un-refuse what the host or another
// registrant refused. Anything that could mutate a write in flight or assert
// acceptance is the class the seam must never offer.
//
// REVOCATION IS THE DISPOSER AND ONLY THE DISPOSER. `id` is a diagnostic label
// and an owner name; it addresses nothing (an address anyone can name is an
// address anyone can forge — the defect that removed `unregisterTools`).

/**
 * The journal's attribution for an operation, verbatim. Mirrored from the
 * host's `JournalActor` and pinned against it by tests/contract.test.ts.
 */
export interface JournalActor {
  transport: string;
  client?: string;
  connection: string;
  session?: string;
  server?: { vault: string; install: string; version: string };
}

/**
 * The exact facts of a COMPLETED write, as the host observed them.
 * `baseBytes: null` means creation.
 *
 * The byte arrays are the host's own buffers, handed over without a per-hook
 * copy; `operation` and `actor` are deep-frozen by the host before dispatch.
 * Nothing here is a capability: no callback, no store handle, no app reference.
 */
export interface WriteFacts {
  path: string;
  baseBytes: Uint8Array | null;
  proposedBytes: Uint8Array;
  operation: { id: string; action: string; actionVersion: number; sessionId: string | null };
  actor: JournalActor;
}

/** A typed refusal, rendered by the host as `Error [code]: detail`. */
export interface SeamRefusal {
  code: string;
  detail: string;
}

export type WriteObserver = (facts: WriteFacts) => void | Promise<void>;
export type SessionRefusalHook = (
  sessionId: string | null,
) => SeamRefusal | null | Promise<SeamRefusal | null>;

/** The registration half of the seam, as it appears on the host's api object. */
export interface GovernanceSeam {
  registerWriteObserver(id: string, observe: WriteObserver): () => void;
  registerSessionRefusal(id: string, refuse: SessionRefusalHook): () => void;
}

export interface GovernanceHooks {
  /** Post-write, observe-only. Throwing or hanging costs the caller nothing. */
  writeObserver?: WriteObserver;
  /** Consulted at dequeue. A refusal aborts the mutation; a throw IS a refusal. */
  sessionRefusal?: SessionRefusalHook;
}

// ── Publisher-facing spec ─────────────────────────────────────────────────────

export interface SdkToolSpec {
  /** Bare name, /^[a-z][a-z0-9_]*$/; published as `<your-plugin-id>_<name>`. */
  name: string;
  description: string;
  /** A zod raw shape ({ path: z.string() }) or a plain JSON Schema object. */
  inputSchema?: Record<string, z.ZodTypeAny> | JsonSchemaObject;
  /** Omitted or false ⇒ the tool counts as MUTATING (blocked by Governor's read-only mode). */
  readOnly?: boolean;
  /** Set true if the tool can destroy user data (delete/overwrite); advisory hint surfaced to MCP clients. */
  destructive?: boolean;
  /** Set true if repeated identical calls have no additional effect. */
  idempotent?: boolean;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

/**
 * The host plugin's id, CURRENT FIRST. The id has moved twice: `vault-mcp` →
 * `governor` at 0.12.0, and `governor` → `vault-mcp` again at the suite split's
 * S3c, when "governor" stopped meaning the whole and started meaning the
 * governance PROVIDER that plugs into the host. The npm package name of this
 * SDK did not change either time (it is a published contract), so one SDK build
 * must work against a host on any side of either migration: it reads BOTH ids
 * and subscribes to BOTH ready events.
 *
 * ORDER IS SIGNIFICANT, and it changed at S3c. `vault-mcp` is now the host, and
 * `governor` is the id of a plugin that is NOT a host — the governance
 * provider, which exposes no `api` property. `getApi` skips an id whose plugin
 * has no `api`, so a post-split vault resolves correctly whichever way round
 * the list is; but a vault carrying BOTH a live pre-split host (`governor`) and
 * a live post-split host (`vault-mcp`) must bind to the newer one, and only
 * this order guarantees it.
 */
const HOST_PLUGIN_IDS = ["vault-mcp", "governor"] as const;
/** Ready events, same order and same reason as HOST_PLUGIN_IDS. */
const HOST_READY_EVENTS = ["vault-mcp:ready", "governor:ready"] as const;
const API_VERSION = 1;

function isJsonSchema(s: NonNullable<SdkToolSpec["inputSchema"]>): s is JsonSchemaObject {
  // A zod raw shape's values are zod schemas, never the string "object",
  // so checking type alone discriminates safely — and accepts a valid
  // property-less JSON Schema like { type: "object" }.
  return (s as JsonSchemaObject).type === "object";
}

function toJsonSchema(s: SdkToolSpec["inputSchema"]): JsonSchemaObject | undefined {
  if (!s) return undefined;
  if (isJsonSchema(s)) return s;
  // Convert INSIDE the publisher's bundle — zod instances must not cross the
  // plugin boundary (each plugin bundles its own zod copy).
  const js = zodToJsonSchema(z.object(s as Record<string, z.ZodTypeAny>), {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  delete js.$schema;
  return js as unknown as JsonSchemaObject;
}

function toExternalSpec(t: SdkToolSpec): ExternalToolSpec {
  return {
    name: t.name,
    description: t.description,
    inputSchema: toJsonSchema(t.inputSchema),
    annotations: {
      readOnlyHint: t.readOnly === true,
      ...(t.destructive !== undefined && { destructiveHint: t.destructive }),
      ...(t.idempotent !== undefined && { idempotentHint: t.idempotent }),
    },
    handler: t.handler,
  };
}

/**
 * Publish MCP tools through Governor. Call from your plugin's onload() and
 * hand the returned disposer to this.register(). Handles load order (registers
 * now or on the host's ready event), re-registration when the host reloads,
 * cleanup. Works against a host on either side of the 0.12.0 `vault-mcp` →
 * `governor` id migration — see HOST_PLUGIN_IDS.
 */
export function publishTools(plugin: Plugin, tools: SdkToolSpec[]): () => void {
  const specs = tools.map(toExternalSpec);
  let unregister: (() => void) | null = null;

  const getApi = (): VaultMcpApi | null => {
    const loaded = (plugin.app as unknown as {
      plugins?: { plugins?: Record<string, { api?: VaultMcpApi }> };
    }).plugins?.plugins;
    for (const id of HOST_PLUGIN_IDS) {
      const api = loaded?.[id]?.api;
      if (!api) continue;
      if (api.apiVersion !== API_VERSION) {
        console.warn(`[vault-mcp-api] '${id}' apiVersion ${api.apiVersion} ≠ supported ${API_VERSION}; not registering '${plugin.manifest.id}' tools`);
        return null;
      }
      return api;
    }
    return null;
  };

  const register = () => {
    const api = getApi();
    if (!api) return;
    try { unregister = api.registerTools(plugin.manifest.id, specs); }
    catch (e) { console.error(`[vault-mcp-api] registerTools failed for '${plugin.manifest.id}'`, e); }
  };

  register(); // the host may already be loaded
  // On host reload the old registry died with the old plugin instance — drop
  // the stale unregister (don't call it) and register into the new one.
  // Subscribing to both events means a single 0.12.0+ host load runs this
  // twice; that is harmless by the host's own contract — same-owner
  // re-registration REPLACES by tool name, and the superseded disposer is
  // object-identity guarded, so it cannot delete the newer entries.
  const refs = HOST_READY_EVENTS.map((evt) =>
    plugin.app.workspace.on(evt as never, () => { unregister = null; register(); }),
  );

  return () => {
    for (const ref of refs) plugin.app.workspace.offref(ref);
    try { unregister?.(); } catch { /* registry may already be gone */ }
    unregister = null;
  };
}

/**
 * Register governance hooks on the host's seam. The provider-side counterpart
 * of `publishTools`, handling the same three things: load order (the host may
 * load after you), re-registration when the host reloads, and cleanup.
 *
 * Hand the returned disposer to `this.register()`. Revoking is the disposer and
 * only the disposer — there is no id-addressed unregister on either side.
 *
 * WHAT REGISTERING BUYS YOU, precisely: the host hands you the bytes of
 * completed writes (candidates flow outward), and asks you whether to refuse a
 * session (refusals flow inward). Neither direction carries authority. A host
 * with no provider registered is the ordinary, vacuous case — every
 * consultation iterates a possibly-empty list — so the host is a complete
 * product without you, and installing you turns audited access into governed
 * access.
 */
export function registerGovernance(plugin: Plugin, hooks: GovernanceHooks): () => void {
  let disposers: Array<() => void> = [];

  const getSeam = (): GovernanceSeam | null => {
    const loaded = (plugin.app as unknown as {
      plugins?: { plugins?: Record<string, { api?: VaultMcpApi & Partial<GovernanceSeam> }> };
    }).plugins?.plugins;
    for (const id of HOST_PLUGIN_IDS) {
      const api = loaded?.[id]?.api;
      if (!api) continue;
      if (api.apiVersion !== API_VERSION) {
        console.warn(`[vault-mcp-api] '${id}' apiVersion ${api.apiVersion} ≠ supported ${API_VERSION}; not registering '${plugin.manifest.id}' governance hooks`);
        return null;
      }
      // A host predating the seam exposes `registerTools` and nothing else.
      // That is not an error and must not be fatal to the provider's load — it
      // means there is no seam to hold, so nothing is registered.
      if (typeof api.registerWriteObserver !== "function" || typeof api.registerSessionRefusal !== "function") {
        console.warn(`[vault-mcp-api] host '${id}' exposes no governance seam; '${plugin.manifest.id}' registered no hooks`);
        return null;
      }
      return api as GovernanceSeam;
    }
    return null;
  };

  const register = () => {
    const seam = getSeam();
    if (!seam) return;
    const id = plugin.manifest.id;
    try {
      const added: Array<() => void> = [];
      if (hooks.writeObserver) added.push(seam.registerWriteObserver(id, hooks.writeObserver));
      if (hooks.sessionRefusal) added.push(seam.registerSessionRefusal(id, hooks.sessionRefusal));
      disposers = added;
    } catch (e) {
      console.error(`[vault-mcp-api] governance registration failed for '${plugin.manifest.id}'`, e);
    }
  };

  /** Revoke every hook this SDK currently holds. Safe to call repeatedly. */
  const disposeAll = () => {
    for (const d of disposers) { try { d(); } catch { /* seam may already be gone */ } }
    disposers = [];
  };

  register(); // the host may already be loaded
  // CALL the old disposers before re-registering — do not merely drop them.
  //
  // This is where the governance seam differs from `publishTools` above, and
  // copying that function's reasoning here was a real bug (fixed 2026-09-08).
  // `registerTools` REPLACES by tool name, so a second registration by the same
  // owner supersedes the first and dropping the stale disposer is correct. The
  // seam has NO replace-by-id: `registerWriteObserver` / `registerSessionRefusal`
  // APPEND an entry to a list, and `id` addresses nothing. So a dropped-but-live
  // registration is not superseded, it is ORPHANED — and the host fires BOTH
  // `vault-mcp:ready` and `governor:ready` on every single load, so the bug
  // fired on every ordinary load: two write observers (two proposals per write,
  // and a DOUBLE mandate-budget charge), two session-refusal hooks, and one
  // un-disposable ghost of each surviving after the human disables the provider
  // in Obsidian's settings — because this SDK's returned disposer can only
  // revoke the set it still holds.
  //
  // Calling a STALE disposer is harmless on the host-reload path too. Each
  // disposer sets its own `disposed` flag (idempotent) and removes its entry by
  // OBJECT IDENTITY from the list it closed over, so it can neither fire twice
  // nor drop a successor's registration — and if the old seam is gone entirely
  // the throw is caught here. Verified against `packages/host/src/mcp/seam.ts`.
  const refs = HOST_READY_EVENTS.map((evt) =>
    plugin.app.workspace.on(evt as never, () => { disposeAll(); register(); }),
  );

  return () => {
    for (const ref of refs) plugin.app.workspace.offref(ref);
    disposeAll();
  };
}
