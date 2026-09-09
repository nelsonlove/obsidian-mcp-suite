// host-shim.mjs — a stand-in for the Vault MCP host's external-tool
// registration, so this package's handler-level tests exercise the ENVELOPES an
// agent actually sees. (Not a `*.test.mjs` file — the test glob skips it.)
//
// Since S3c these five tools are no longer registered on an `McpServer` inside
// the host. They are PUBLISHED through `vault-mcp-api` as `SdkToolSpec[]`, and a
// published tool's handler returns plain data or throws: the host turns the
// first into `ok(data)` and the second into `fail(err)`, where `fail` renders a
// lowercase-snake `code` off the error as `Error [code]: message`. That is the
// contract `src/tools/*.ts` is now written against, so testing the raw handlers
// alone would leave the refusal shape — the thing the old `codedError` used to
// guarantee — unpinned.
//
// This shim reproduces exactly FOUR host behaviours and nothing else. The first
// three are `packages/crosssession/tests/host-shim.mjs`'s, verbatim in intent;
// the fourth is this package's alone.
//
//   1. THE PUBLISHED NAME, including THE GRANDFATHER TABLE. The ordinary rule is
//      `<sanitized owner id>_<bare name>` and this plugin's id is `governor`, so
//      a new tool would publish as `governor_<name>`. These five do not: the host
//      carries a closed table naming both the spelling AND the single owner id
//      allowed to publish it unprefixed, so `governance_revisions` stays
//      `governance_revisions` and `obsidian_pending_review` survives the F1
//      `obsidian_*` refusal. The table below is a SNAPSHOT of the host's
//      (`packages/host/src/mcp/external-tools.ts`), carried as DATA. The pin that
//      SHOULD fire when the host's table changes is the host's own test over the
//      live `GRANDFATHERED_TOOL_NAMES` / `publishedToolName`, never this copy —
//      and as of 2026-09-08 THAT TEST DOES NOT EXIST: `packages/host/tests/
//      external-tools.test.mjs` covers F1 only through the ungrandfathered case
//      (owner `obsidian-read` + name `note`), and neither it nor
//      `packages/vault-mcp-api/tests/` names any of the five spellings. So this
//      snapshot is currently the ONLY place the five names are asserted, which
//      makes it a review aid doing a tripwire's job. Named here rather than
//      quietly relied on: the host owes the live pin.
//   2. THE ENVELOPE. `ok` / `fail`, including `fail`'s coded rendering and its
//      lowercase-snake gate (a Node error's UPPERCASE `.code` renders plain), so
//      a `GovernanceRefusal` is asserted as the agent-visible
//      `Error [code]: message` string rather than as a thrown object.
//   3. THE ANNOTATIONS the host derives from an UNTRUSTED `readOnly` claim.
//      `readOnlyHint: true` from a publisher is an assertion about code the host
//      cannot inspect, so it is believed only when the RAW plugin id is listed in
//      `trustedReadOnlyPlugins` (empty by default). Untrusted ⇒ registered as
//      MUTATING, which is why `governance_mandates`, `governance_revisions` and
//      `obsidian_pending_review` are blocked in read-only mode despite reading
//      nothing. `trusted: true` opts into believing the claim, for the tests that
//      pin the difference. The base presets are `@vault-mcp/core`'s
//      SHARED_ANNOTATIONS RO/RW, reproduced literally — note `destructiveHint`
//      defaults to FALSE on both, and only an explicit `destructive` on the spec
//      overrides it.
//   4. THE F1 REFUSAL, but only far enough to keep the carve-out honest. A
//      PUBLISHED name beginning `obsidian_` is refused unless the table
//      grandfathers it for that exact owner. Note what that does and does not
//      mean, because it is easy to overstate: an ungrandfathered `obsidian_x`
//      from owner `governor` publishes as `governor_obsidian_x` and is never
//      refused — F1 only bites when the OWNER ID itself sanitizes into the
//      reserved namespace. The tests plant both cases.
//
// It deliberately does NOT reproduce the F3 pathless-tool block, the path
// allowlist, the write queue, the write journal, read-only mode, the kernel
// arguments, or the record-immutability guard. Those are host code with host
// tests, and a second copy could drift into asserting a posture the host does
// not enforce. What this package DOES pin about them is the only half it owns —
// which of its arguments the host would recognize as a path (see
// `publication.test.mjs`).

/** This plugin's own id — unchanged by the split, because the authority state did not move. */
const PLUGIN_ID = "governor";

/** The host's `sanitizeOwnerId`, verbatim. */
export function sanitizeOwnerId(id) {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export const OWNER = sanitizeOwnerId(PLUGIN_ID);

/**
 * A SNAPSHOT of the host's `GRANDFATHERED_TOOL_NAMES` — bare name → the one
 * owner id allowed to publish it unprefixed. Carried as data for the reason
 * stated in the header: the live pin is the host's own test, this copy exists so
 * a change on either side surfaces as a diff in review.
 *
 * IT IS CLOSED on the host's side and must stay closed here. A sixth entry in
 * this file would assert a carve-out the host does not grant, which is exactly
 * the drift a shim is supposed to make visible rather than hide.
 */
export const HOST_GRANDFATHERED_TOOL_NAMES = new Map([
  ["obsidian_pending_review", "governor"],
  ["governance_revisions", "governor"],
  ["governance_submit_revision", "governor"],
  ["governance_mandate_draft", "governor"],
  ["governance_mandates", "governor"],
]);

/**
 * The host's `PATH_KEYS` + `ARRAY_PATH_KEYS` (`packages/host/src/guard.ts`),
 * copied as DATA so this package can assert which of its own argument names the
 * host would recognize. The host owns the enforcement; this is only the list the
 * assertion reads against, spelled out so a host addition (or removal) shows up
 * as a diff in review rather than silently changing this package's posture.
 *
 * `note_path` joined the host's list on 2026-09-07 (the mutating tier's round
 * one). No tool in THIS package names it — `governance_submit_revision` has
 * always spelled its argument `path` — so this package's posture is unchanged by
 * that addition.
 */
export const HOST_PATH_KEYS = [
  "path", "from", "to", "target_path", "template_path", "subdir", "file_path", "output_folder", "note_path",
  "paths", "refs",
];

/** The host's `publishedToolName` (`external-tools.ts`), verbatim over the snapshot. */
export function publishedToolName(ownerPluginId, bareName) {
  if (HOST_GRANDFATHERED_TOOL_NAMES.get(bareName) === ownerPluginId) {
    return { toolName: bareName, grandfathered: true };
  }
  return { toolName: `${sanitizeOwnerId(ownerPluginId)}_${bareName}`, grandfathered: false };
}

/** The host's `ok()` (from `@vault-mcp/core` via `mcp/helpers.ts`). */
function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data };
}

/** The host's `fail()`, including the coded branch and its lowercase-snake gate. */
function fail(err) {
  const message = err instanceof Error ? err.message : String(err);
  const code = err?.code;
  if (typeof code === "string" && /^[a-z][a-z0-9_]*$/.test(code)) {
    return { content: [{ type: "text", text: `Error [${code}]: ${message}` }], isError: true };
  }
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

/** `@vault-mcp/core`'s SHARED_ANNOTATIONS.RO / .RW, reproduced literally. */
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

/**
 * Publish SDK tool specs the way the host does.
 *
 * `owner` defaults to this plugin's id; a test passes another to prove the
 * grandfather carve-out is gated on the owner as well as on the name.
 *
 * Returns `{ tools }`, a Map from the PUBLISHED name to `{ def, spec, handler }`
 * — the same shape the host's own `fakeServer` produces, so assertions read the
 * same on both sides of the split. `def.claimsReadOnly` records the publisher's
 * raw assertion beside the host's conclusion, because the gap between them IS
 * this package's allowlist posture.
 *
 * Throws on an F1 collision, exactly as `ExternalToolRegistry.registerTools`
 * does — see the header's point 4.
 */
export function publishInto(specs, { trusted = false, owner = PLUGIN_ID } = {}) {
  const tools = new Map();
  for (const spec of specs) {
    const { toolName, grandfathered } = publishedToolName(owner, spec.name);
    if (!grandfathered && toolName.startsWith("obsidian_")) {
      throw new TypeError(`vault-mcp: tool name '${toolName}' collides with the reserved obsidian_* namespace`);
    }
    const claimsReadOnly = spec.readOnly === true;
    const isReadOnly = claimsReadOnly && trusted;
    const annotations = { ...(isReadOnly ? RO : RW) };
    // The SDK only forwards these two when the spec sets them; the host only
    // overlays them when forwarded. Two conditionals, one observable rule.
    if (spec.destructive !== undefined) annotations.destructiveHint = spec.destructive;
    if (spec.idempotent !== undefined) annotations.idempotentHint = spec.idempotent;
    const def = { title: toolName, description: spec.description, inputSchema: spec.inputSchema, annotations, claimsReadOnly };
    tools.set(toolName, {
      def,
      spec,
      grandfathered,
      handler: async (args) => {
        try {
          // F5: the host normalizes a handler's return value to a plain object
          // so `ok()` emits valid structuredContent.
          const r = await spec.handler(args ?? {});
          const data =
            r === undefined ? { ok: true } : typeof r === "object" && r !== null && !Array.isArray(r) ? r : { result: r };
          return ok(data);
        } catch (e) {
          return fail(e);
        }
      },
    });
  }
  return { tools };
}

/** The agent-visible text of a result envelope — the string a refusal actually reads as. */
export function errText(res) {
  return res?.content?.[0]?.text ?? "";
}
