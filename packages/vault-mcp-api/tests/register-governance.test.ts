// tests/register-governance.test.ts
//
// `registerGovernance` had no behavioural test at all until 2026-09-08, which is
// how F1 shipped: the ready-event handler DROPPED its disposers and re-registered,
// copying `publishTools`' pattern across a seam that does not share the property
// that makes it safe there. `registerTools` replaces by tool NAME; the seam
// APPENDS and has no replace-by-id, so a dropped-but-live registration is
// orphaned rather than superseded — and the host fires both ready events on
// every load, so the duplicate landed on every ordinary load.
//
// The fake seam below reproduces `packages/host/src/mcp/seam.ts`'s registration
// semantics exactly, because the bug is entirely about those semantics:
//   • register APPENDS an entry; `id` addresses nothing;
//   • the disposer removes ITS OWN entry by object identity;
//   • the disposer is idempotent (a `disposed` flag), so a spent one can never
//     drop a successor.
// A fake that replaced by id, or whose disposer cleared the list, would pass
// under the buggy code and assert nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerGovernance, type WriteObserver, type SessionRefusalHook } from "../src/index.js";

function fakeSeam(apiVersion = 1) {
  const observers: Array<{ id: string; fn: WriteObserver }> = [];
  const refusals: Array<{ id: string; fn: SessionRefusalHook }> = [];
  const drop = <T>(list: T[], entry: T) => {
    const i = list.indexOf(entry);
    if (i >= 0) list.splice(i, 1);
  };
  return {
    observers,
    refusals,
    apiVersion,
    registerTools: () => () => {},
    registerWriteObserver(id: string, fn: WriteObserver) {
      const entry = { id, fn };
      observers.push(entry);
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        drop(observers, entry);
      };
    },
    registerSessionRefusal(id: string, fn: SessionRefusalHook) {
      const entry = { id, fn };
      refusals.push(entry);
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        drop(refusals, entry);
      };
    },
  };
}

function fakeWorld(api: unknown, hostId = "vault-mcp") {
  const handlers = new Map<object, { name: string; cb: (...a: unknown[]) => void }>();
  const app = {
    workspace: {
      on: (name: string, cb: (...a: unknown[]) => void) => { const ref = {}; handlers.set(ref, { name, cb }); return ref; },
      offref: (ref: object) => { handlers.delete(ref); },
      trigger: (name: string, ...a: unknown[]) => { for (const h of handlers.values()) if (h.name === name) h.cb(...a); },
    },
    plugins: { plugins: (api ? { [hostId]: { api } } : {}) as Record<string, unknown> },
  };
  return { app, handlers };
}

const plugin = (app: unknown) => ({ app, manifest: { id: "governor" } }) as never;
const hooks = () => ({ writeObserver: () => {}, sessionRefusal: () => null });

test("registers both hooks immediately when the host is already loaded", () => {
  const seam = fakeSeam();
  const { app } = fakeWorld(seam);
  registerGovernance(plugin(app), hooks());
  assert.equal(seam.observers.length, 1);
  assert.equal(seam.refusals.length, 1);
  assert.equal(seam.observers[0].id, "governor");
});

test("only the declared hooks are registered", () => {
  const seam = fakeSeam();
  const { app } = fakeWorld(seam);
  registerGovernance(plugin(app), { writeObserver: () => {} });
  assert.equal(seam.observers.length, 1);
  assert.equal(seam.refusals.length, 0);
});

test("waits for the host's ready event when the host is not loaded yet", () => {
  const seam = fakeSeam();
  const { app } = fakeWorld(null);
  registerGovernance(plugin(app), hooks());
  assert.equal(seam.observers.length, 0);
  (app.plugins.plugins as Record<string, unknown>)["vault-mcp"] = { api: seam };
  app.workspace.trigger("vault-mcp:ready", seam);
  assert.equal(seam.observers.length, 1);
});

// ── F1: THE PIN ──────────────────────────────────────────────────────────────
// The host fires BOTH ready events on every load (main.ts triggers
// `${PLUGIN_ID}:ready` and `${LEGACY_PLUGIN_ID}:ready` back to back), and this
// SDK subscribes to both. The equivalent case for tools is
// publish-tools.test.ts's "both host events firing on one load is harmless",
// where a SECOND registration is the right answer because the host replaces by
// name. Here it is the wrong answer, so the assertion is the opposite one:
// exactly one live hook of each class, however many times the host says ready.
test("both host events firing on one load leaves exactly ONE live hook of each class", () => {
  const seam = fakeSeam();
  const { app } = fakeWorld(null);
  registerGovernance(plugin(app), hooks());
  (app.plugins.plugins as Record<string, unknown>)["vault-mcp"] = { api: seam };
  app.workspace.trigger("vault-mcp:ready", seam);
  app.workspace.trigger("governor:ready", seam);
  // Two observers here would mean two proposals per write and a DOUBLE
  // mandate-budget charge; two refusal hooks would consult the provider twice.
  assert.equal(seam.observers.length, 1);
  assert.equal(seam.refusals.length, 1);
});

test("a host that is already loaded and then says ready twice still leaves ONE of each", () => {
  const seam = fakeSeam();
  const { app } = fakeWorld(seam);
  registerGovernance(plugin(app), hooks());
  app.workspace.trigger("vault-mcp:ready", seam);
  app.workspace.trigger("governor:ready", seam);
  assert.equal(seam.observers.length, 1);
  assert.equal(seam.refusals.length, 1);
});

// ── F1: NO GHOST HOOKS SURVIVE THE PROVIDER'S DISABLE ────────────────────────
// The disposer this SDK returns is handed to `this.register()`, so Obsidian
// calls it when the human disables the provider. It can only revoke the set the
// SDK still HOLDS — so any registration the SDK dropped without disposing stays
// on the live seam forever, still producing proposals for a provider the human
// switched off.
test("the provider's disable disposes every hook from a LIVE seam — no ghost observer", () => {
  const seam = fakeSeam();
  const { app, handlers } = fakeWorld(null);
  const dispose = registerGovernance(plugin(app), hooks());
  (app.plugins.plugins as Record<string, unknown>)["vault-mcp"] = { api: seam };
  // The ordinary load: both events, one live seam.
  app.workspace.trigger("vault-mcp:ready", seam);
  app.workspace.trigger("governor:ready", seam);
  assert.equal(handlers.size, 2); // one listener per host ready event

  dispose(); // the human disables Governor in Obsidian's settings

  assert.equal(seam.observers.length, 0);
  assert.equal(seam.refusals.length, 0);
  assert.equal(handlers.size, 0);
  // And it stays inert: a later host reload must not resurrect the hooks.
  app.workspace.trigger("vault-mcp:ready", seam);
  assert.equal(seam.observers.length, 0);
});

test("re-registers into a RELOADED host's fresh seam, and the stale disposer is harmless", () => {
  const first = fakeSeam();
  const { app } = fakeWorld(first);
  const dispose = registerGovernance(plugin(app), hooks());
  assert.equal(first.observers.length, 1);

  // The host reloads: a new plugin instance with a new seam object.
  const second = fakeSeam();
  (app.plugins.plugins as Record<string, unknown>)["vault-mcp"] = { api: second };
  app.workspace.trigger("vault-mcp:ready", second);
  app.workspace.trigger("governor:ready", second);

  assert.equal(first.observers.length, 0);  // the stale registration was revoked, not leaked
  assert.equal(second.observers.length, 1); // and exactly one landed on the new seam
  assert.equal(second.refusals.length, 1);

  dispose();
  assert.equal(second.observers.length, 0);
});

test("a spent disposer can never drop a successor's registration", () => {
  // The property that makes calling the stale disposers safe. Registering the
  // NEW hooks first and disposing the OLD ones second must still leave the new
  // ones in place — which is what the seam's identity-guarded, idempotent
  // disposer buys, and what the comment in index.ts asserts.
  const seam = fakeSeam();
  const observe: WriteObserver = () => {};
  const stale = seam.registerWriteObserver("governor", observe);
  seam.registerWriteObserver("governor", observe); // same id, same function
  assert.equal(seam.observers.length, 2);
  stale();
  stale(); // idempotent
  assert.equal(seam.observers.length, 1);
});

test("a pre-seam host (registerTools only) registers nothing and does not throw", () => {
  const api = { apiVersion: 1, registerTools: () => () => {} };
  const { app } = fakeWorld(api);
  const dispose = registerGovernance(plugin(app), hooks());
  dispose(); // must not throw with nothing held
});

test("apiVersion mismatch registers nothing", () => {
  const seam = fakeSeam(2);
  const { app } = fakeWorld(seam);
  registerGovernance(plugin(app), hooks());
  assert.equal(seam.observers.length, 0);
  assert.equal(seam.refusals.length, 0);
});

// The post-split vault: `governor` IS this provider and exposes no api, so the
// lookup must fall through to `vault-mcp` — the same discriminator
// `publishTools` uses, on the same list, in the same order.
test("a `governor` plugin with no api is skipped; the host is found under `vault-mcp`", () => {
  const seam = fakeSeam();
  const { app } = fakeWorld(seam, "vault-mcp");
  (app.plugins.plugins as Record<string, unknown>)["governor"] = {};
  registerGovernance(plugin(app), hooks());
  assert.equal(seam.observers.length, 1);
});
