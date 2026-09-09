/**
 * publication.test.mjs — what this plugin puts on the wire, and what the host's
 * guard can and cannot do with it. The `publication` test every satellite
 * package carries, for the one satellite that is not a satellite.
 *
 * Three questions, and each answer is a decision this package has to keep honest
 * rather than a property that follows from anything:
 *
 *   1. THE FIVE NAMES. An external tool ordinarily publishes as
 *      `<sanitized owner id>_<bare name>`, and this plugin's id is `governor`,
 *      so the default spellings would be `governor_governance_*`. They are not,
 *      because the host carries a closed exact-name table. Asserting the exact
 *      five spellings is the only thing standing between an agent's tool list
 *      and a silent rename.
 *   2. THE readOnly FLAGS, claim and conclusion. Four of the five CLAIM
 *      read-only; the host believes none of them by default.
 *   3. WHICH ARGUMENT THE HOST WOULD RECOGNIZE AS A PATH. Exactly one —
 *      `governance_submit_revision`'s `path` — which is what decides whether the
 *      F3 gate scopes a call or refuses it wholesale.
 *
 * The host's `PATH_KEYS` and its exact-name table are carried in
 * `tests/host-shim.mjs` as DATA SNAPSHOTS. They are review aids: the pin that
 * fires when the host changes `PATH_KEYS` is its own `guard.test.mjs` over the
 * live `collectPaths`, and the pin that should fire when it changes the
 * exact-name table is a host test that DOES NOT EXIST as of 2026-09-08 — see the
 * shim's header, where the gap is named rather than relied on.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { publishInto, HOST_PATH_KEYS, HOST_GRANDFATHERED_TOOL_NAMES, OWNER } from "./host-shim.mjs";
import { buildPendingReviewTools } from "../src/tools/pending-review.ts";
import { buildRevisionTools } from "../src/tools/revision.ts";
import { buildMandateTools } from "../src/tools/mandate.ts";

/** Every spec this plugin publishes, in `main.ts`'s order. */
function allSpecs() {
  return [
    ...buildPendingReviewTools({ source: { read: async () => null } }),
    ...buildRevisionTools(
      { read: async () => null, write: async () => {}, now: () => new Date(0) },
      { listNotes: async () => [], read: async () => null },
    ),
    ...buildMandateTools({
      draft: async () => {},
      allDrafts: async () => [],
      allMandates: async () => [],
      usageOf: async () => ({}),
      sessionId: () => null,
      client: () => null,
      now: () => 0,
    }),
  ];
}

const EXPECTED = [
  "governance_pending_review",
  "governance_submit_revision",
  "governance_revisions",
  "governance_mandate_draft",
  "governance_mandates",
];

describe("publication: names, flags, and what the host's guard can scope", () => {
  test("the plugin id sanitizes to `governor`, and the five names publish BARE anyway", () => {
    assert.equal(OWNER, "governor");
    const { tools } = publishInto(allSpecs());
    assert.deepEqual([...tools.keys()].sort(), [...EXPECTED].sort());
    for (const name of EXPECTED) {
      assert.equal(tools.get(name).bare, true, `${name} must not publish as governor_${name}`);
      assert.equal(HOST_GRANDFATHERED_TOOL_NAMES.get(name), "governor", `${name} is in the host's table, owned by governor`);
    }
    assert.equal(HOST_GRANDFATHERED_TOOL_NAMES.size, 5, "the table is closed — five entries, no more");
  });

  test("VACUITY: without the table every one of them would be prefixed", () => {
    // The assertion above is only meaningful if the ordinary rule would have
    // produced something different. Publishing the same specs under any other
    // owner id is the plant: the table is keyed on the owner, so the carve-out
    // does not apply and the default `<owner>_<name>` form appears.
    const { tools } = publishInto(allSpecs(), { owner: "not-governor" });
    assert.deepEqual(
      [...tools.keys()].sort(),
      EXPECTED.map((n) => `not_governor_${n}`).sort(),
      "the bare names above are the table's doing, not the shim's",
    );
  });

  test("no published name enters the reserved `obsidian_*` namespace — F1 has no exception left", () => {
    // The 2026-09-08 ruling, pinned at the surface it was about. The first S3c
    // draft published `obsidian_pending_review` through an F1 carve-out; the
    // tool was renamed instead, so the reserved namespace is intact and this
    // plugin's tool list says what these tools are.
    for (const spec of allSpecs()) {
      assert.ok(!spec.name.startsWith("obsidian_"), `${spec.name} would need an F1 exception`);
    }
    for (const name of HOST_GRANDFATHERED_TOOL_NAMES.keys()) {
      assert.ok(!name.startsWith("obsidian_"), `${name} would make the table an F1 exception`);
    }
  });

  test("readOnly flags match the tool inventory — and an untrusted claim registers as MUTATING", () => {
    // The claim is the publisher's; the conclusion is the host's. Both are
    // asserted, because the GAP between them is this package's whole allowlist
    // and read-only-mode posture: a tool that structurally cannot write is
    // nonetheless blocked in read-only mode unless the operator lists `governor`
    // in `trustedReadOnlyPlugins`.
    const claims = {
      governance_pending_review: true,
      governance_revisions: true,
      governance_mandates: true,
      governance_mandate_draft: false,
      governance_submit_revision: false,
    };
    const untrusted = publishInto(allSpecs()).tools;
    const trusted = publishInto(allSpecs(), { trusted: true }).tools;
    for (const [name, claimed] of Object.entries(claims)) {
      assert.equal(untrusted.get(name).def.claimsReadOnly, claimed, `${name} claim`);
      assert.equal(untrusted.get(name).def.annotations.readOnlyHint, false, `${name} is mutating while untrusted`);
      assert.equal(trusted.get(name).def.annotations.readOnlyHint, claimed, `${name} under a trusted publisher`);
      // Nothing here is destructive, trusted or not: both SHARED_ANNOTATIONS
      // presets carry `destructiveHint: false` and no spec overrides it.
      assert.equal(untrusted.get(name).def.annotations.destructiveHint, false, `${name} destructive`);
    }
    // The two MUTATING ones are mutating by their own declaration, so trust
    // cannot move them — `governance_mandate_draft` writes a draft into the
    // mandate store and `governance_submit_revision` writes a note.
    assert.equal(trusted.get("governance_mandate_draft").def.annotations.readOnlyHint, false);
    assert.equal(trusted.get("governance_submit_revision").def.annotations.readOnlyHint, false);
  });

  test("EXACTLY ONE argument is a host path key: governance_submit_revision's `path`", () => {
    // THE CONSEQUENCE, stated because it is the operative fact and it is
    // fail-CLOSED: the host's F3 gate refuses any external tool whose arguments
    // carry no recognized path field while a path allowlist is ACTIVE, since a
    // call it cannot scope is a call it cannot bound. So under an allowlist,
    // four of these five are unavailable WHOLESALE — the review queue, the
    // revision listing, the mandate listing and mandate drafting all simply
    // refuse — and only `governance_submit_revision` proceeds, scoped per-path
    // like any built-in write.
    //
    // That is strictly stricter than the in-tool `isVisible` filtering these
    // tools did as host modules, and it is why their `getSettings` seams are
    // kept DORMANT rather than deleted: an apiVersion-2 SDK carrying the
    // caller's scope to a publisher wakes them with no code change and makes the
    // gate scopable again.
    //
    // Renaming an argument INTO a path key would be the wrong fix for the four.
    // `folder` on `governance_revisions` names a filter, not a write target;
    // the mandate tools name no vault path at all; and the review queue takes no
    // arguments whatsoever. Path-keying any of them would scope something other
    // than what the call touches — the illusion of a check (the `channel`
    // reasoning from the cross-session extraction).
    const pathKeysIn = (specs) => {
      const found = [];
      for (const spec of specs) {
        for (const key of Object.keys(spec.inputSchema ?? {})) {
          if (HOST_PATH_KEYS.includes(key)) found.push(`${spec.name}.${key}`);
        }
      }
      return found;
    };
    assert.deepEqual(pathKeysIn(allSpecs()), ["governance_submit_revision.path"]);

    // VACUITY, against a planted violation: the same scan over specs where one
    // of the four pathless tools grew a `note_path` argument must SEE it. A scan
    // that silently found nothing would pass the assertion above for exactly the
    // wrong reason.
    const planted = allSpecs().map((s) =>
      s.name === "governance_revisions" ? { ...s, inputSchema: { ...s.inputSchema, note_path: {} } } : s,
    );
    assert.deepEqual(
      pathKeysIn(planted).sort(),
      ["governance_revisions.note_path", "governance_submit_revision.path"],
      "the scan catches a newly path-keyed argument",
    );
  });

  test("the four pathless tools really are pathless — argument by argument", () => {
    // The negative half, spelled out so a future argument added to any of them
    // has to be looked at rather than merely compiled.
    const byName = Object.fromEntries(allSpecs().map((s) => [s.name, Object.keys(s.inputSchema ?? {})]));
    assert.deepEqual(byName.governance_pending_review, [], "takes no arguments at all");
    assert.deepEqual(byName.governance_mandates, [], "takes no arguments at all");
    assert.deepEqual(byName.governance_revisions, ["folder"], "`folder` is a filter, not a target");
    assert.ok(!byName.governance_mandate_draft.some((k) => HOST_PATH_KEYS.includes(k)));
    // `scope_include` / `scope_exclude` carry vault path PREFIXES and are the
    // near-miss worth naming: they are not path keys, so the host cannot scope a
    // draft by them, and the tool re-checks them itself against the dormant
    // `getSettings` seam (`out_of_allowlist`). Under a live allowlist F3 refuses
    // the whole call first, so the in-tool check is belt behind a closed door.
    assert.ok(byName.governance_mandate_draft.includes("scope_include"));
    assert.ok(!HOST_PATH_KEYS.includes("scope_include"));
    assert.ok(!HOST_PATH_KEYS.includes("folder"));
  });

  test("VACUITY: the path-key snapshot is a real list and `path` is really in it", () => {
    // A scan against an empty or mistyped list finds nothing and passes the
    // "exactly one" assertion for the wrong reason.
    assert.ok(HOST_PATH_KEYS.includes("path"), "the snapshot contains the key the assertion turns on");
    assert.ok(HOST_PATH_KEYS.length >= 11, "and it is the host's whole list, not a fragment");
  });

  test("every spec is publishable at all: a bare lowercase-snake name and a callable handler", () => {
    // The host validates the whole array BEFORE inserting anything, so one
    // malformed spec costs the plugin its entire tool surface rather than one
    // tool. Cheap to assert, and the failure it prevents is total.
    for (const spec of allSpecs()) {
      assert.match(spec.name, /^[a-z][a-z0-9_]*$/, spec.name);
      assert.equal(typeof spec.handler, "function", spec.name);
      assert.ok(spec.description.length > 40, `${spec.name} needs a description an agent can act on`);
    }
    assert.equal(new Set(allSpecs().map((s) => s.name)).size, 5, "no two specs share a name");
  });
});
