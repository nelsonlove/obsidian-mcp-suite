// governance_revisions — the read-side discovery listing (parser + tool).
//
// S3c: the listing is no longer registered by `registerGovernanceRevisionsListTool(server, listing)`.
// `buildRevisionTools(source, listing)` returns BOTH revision specs — the submit
// verb and this listing — and the host publishes them through `vault-mcp-api`.
// So the tests run the specs through `tests/host-shim.mjs`, which reproduces the
// published name, the `ok()` envelope, and the annotations the host derives from
// an UNTRUSTED `readOnly` claim.
//
// The one assertion that had to change shape rather than target is the read-only
// one. `readOnly: true` on the spec is now a CLAIM about code the host cannot
// inspect, believed only if the operator lists `governor` in
// `trustedReadOnlyPlugins`; untrusted, the host registers it MUTATING. The old
// `readOnlyHint === true` is therefore split into the claim and the host's
// conclusion, and both are asserted — weakening neither, and pinning the gap
// between them, which is the whole reason this tool is unavailable under a path
// allowlist (see publication.test.mjs).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseRevisionRequestCallouts } from "../src/kernel/revision.ts";
import { buildRevisionTools } from "../src/tools/revision.ts";
import { publishInto } from "./host-shim.mjs";

describe("parseRevisionRequestCallouts", () => {
  test("parses date and text from a standard request callout", () => {
    const body = [
      "# Title",
      "",
      "> [!revision-request] Requested changes (2026-08-18)",
      "> Tighten the summary.",
      "> Cover the edge case.",
      "",
      "Body text.",
    ].join("\n");
    const out = parseRevisionRequestCallouts(body);
    assert.equal(out.length, 1);
    assert.equal(out[0].date, "2026-08-18");
    assert.equal(out[0].text, "Tighten the summary.\nCover the edge case.");
  });

  test("multiple callouts each parse; non-request callouts are ignored", () => {
    const body = [
      "> [!revision-request] Requested changes (2026-08-01)",
      "> First ask.",
      "",
      "> [!note] Unrelated callout",
      "> Not a request.",
      "",
      "> [!revision-request] Requested changes",
      "> Second ask, no date.",
    ].join("\n");
    const out = parseRevisionRequestCallouts(body);
    assert.equal(out.length, 2);
    assert.equal(out[0].date, "2026-08-01");
    assert.equal(out[1].date, null);
    assert.equal(out[1].text, "Second ask, no date.");
  });

  test("mirrors the remover: CRLF bodies parse, and a body with no callouts yields []", () => {
    const crlf = "> [!revision-request] Requested changes (2026-08-18)\r\n> Fix EOLs.\r\n";
    const out = parseRevisionRequestCallouts(crlf);
    assert.equal(out.length, 1);
    assert.equal(out[0].text, "Fix EOLs.");
    assert.deepEqual(parseRevisionRequestCallouts("# Nothing here\n\nplain body"), []);
  });
});

const NOTE = (status) =>
  `---\nacceptance-status: ${status}\n---\n\n# N\n\n> [!revision-request] Requested changes (2026-08-18)\n> Do the thing.\n`;

/** Publish the revision specs and hand back the listing tool under its wire name. */
function listingTool(listing, { trusted = false } = {}) {
  const specs = buildRevisionTools({ read: async () => null, write: async () => {}, now: () => new Date(0) }, listing);
  const { tools } = publishInto(specs, { trusted });
  return { specs, tools, entry: tools.get("governance_revisions") };
}

describe("governance_revisions tool", () => {
  test("publishes UNPREFIXED as governance_revisions — the grandfathered spelling", () => {
    const { specs, entry } = listingTool({ listNotes: async () => [], read: async () => null });
    assert.ok(specs.some((s) => s.name === "governance_revisions"));
    assert.ok(entry, "the wire name is `governance_revisions`, not `governor_governance_revisions`");
    assert.equal(entry.bare, true);
  });

  test("lists only revising notes, parses requests, and CLAIMS read-only (untrusted ⇒ mutating)", async () => {
    const { entry } = listingTool({
      listNotes: async () => [
        { path: "A/revising.md", frontmatter: { "acceptance-status": "revising" } },
        { path: "A/proposed.md", frontmatter: { "acceptance-status": "proposed" } },
        { path: "A/plain.md", frontmatter: null },
      ],
      read: async (p) => (p === "A/revising.md" ? NOTE("revising") : "# other\n"),
    });
    assert.equal(entry.def.claimsReadOnly, true, "the spec still asserts it reads nothing");
    assert.equal(entry.def.annotations.readOnlyHint, false, "and the host distrusts that assertion by default");
    const res = await entry.handler({});
    const s = res.structuredContent;
    assert.equal(s.count, 1);
    assert.equal(s.items[0].path, "A/revising.md");
    assert.equal(s.items[0].requests[0].text, "Do the thing.");
    assert.equal(s.items[0].requests[0].date, "2026-08-18");
  });

  test("a TRUSTED publisher gets the read-only annotation it claimed", () => {
    const { entry } = listingTool({ listNotes: async () => [], read: async () => null }, { trusted: true });
    assert.equal(entry.def.annotations.readOnlyHint, true);
    assert.equal(entry.def.annotations.idempotentHint, true);
    assert.equal(entry.def.annotations.destructiveHint, false);
  });

  test("allowlist filters via isVisible; folder prefix filters; race-deleted note drops", async () => {
    const { entry } = listingTool({
      listNotes: async () => [
        { path: "Vis/a.md", frontmatter: { "acceptance-status": "revising" } },
        { path: "Hidden/b.md", frontmatter: { "acceptance-status": "revising" } },
        { path: "Vis/sub/c.md", frontmatter: { "acceptance-status": "revising" } },
        { path: "Vis/gone.md", frontmatter: { "acceptance-status": "revising" } },
      ],
      read: async (p) => (p === "Vis/gone.md" ? null : NOTE("revising")),
      // The DORMANT seam, supplied here so it cannot rot: nothing wires
      // `getSettings` in the shipped configuration (a satellite cannot reach the
      // host's guard settings), and under an active allowlist the host blocks
      // this tool wholesale anyway. It stays because an apiVersion-2 SDK that
      // carries the caller's scope to a publisher wakes it with no code change.
      getSettings: () => ({ readOnly: false, allowlist: ["Vis"] }),
    });
    const all = (await entry.handler({})).structuredContent;
    assert.deepEqual(all.items.map((i) => i.path).sort(), ["Vis/a.md", "Vis/sub/c.md"]);
    const sub = (await entry.handler({ folder: "Vis/sub" })).structuredContent;
    assert.deepEqual(sub.items.map((i) => i.path), ["Vis/sub/c.md"]);
  });

  test("cap: truncated flag set and total reported when over 100", async () => {
    const notes = Array.from({ length: 120 }, (_, i) => ({
      path: `N/${String(i).padStart(3, "0")}.md`,
      frontmatter: { "acceptance-status": "revising" },
    }));
    const { entry } = listingTool({ listNotes: async () => notes, read: async () => NOTE("revising") });
    const s = (await entry.handler({})).structuredContent;
    assert.equal(s.count, 100);
    assert.equal(s.total_revising, 120);
    assert.equal(s.truncated, true);
  });
});
