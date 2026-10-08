# apiVersion 2 — design (#399)

Status: **ruled 2026-09-26** (see Decisions). Nothing here is built yet; v2 = members 2 and 3, member 1 deferred to v3. Three members, one bump, and a sequencing rule that keeps every shipped satellite working through it. Written by the `[C2] vault-mcp-suite` session; rulings go in the Decisions section at the end, in Nelson's words.

## 1. Why one bump, and why now

Three separate gaps have each been logged as "an apiVersion-2 item" and left there:

1. **Address resolution is host-only.** `jd:<address>` and `uid:<value>` resolve inside `mcp/guarded.ts` (`resolveAndGuard`), at the interception point every tool's path arguments pass through, BEFORE the allowlist checks the resolved path. That is why scheme stayed in the host (ruled 2026-09-05 at S8): a satellite cannot sit there. The cost is that a third-party scheme (PARA, GTD, anything not Johnny Decimal) is a host PR, not a plugin.
2. **A published tool cannot return a partial result.** The fileclass satellite's failed CLI run used to be `okError()` — a structured report plus `isError: true`. The publishing boundary has only `ok(data)` and `fail(err)`, so the satellite now RETURNS the report with `succeeded: false`: a failure arrives as a successful call. `packages/fileclass/src/tools.ts` names this as the apiVersion-2 gap.
3. **A published tool cannot see the caller's scope.** Every satellite that used to filter by the allowlist (`isVisible`) kept the seam and left it dormant — bases, crosssession, skills, triage, governor's mandate tools all say "apiVersion 2 re-lights it". Under an allowlist the host refuses pathless external tools wholesale (F3) because it cannot scope them; that is fail-closed and correct, and it makes those tools unusable in a scoped session.

They are one bump because each is an ADDITIVE change to the same object (`plugin.api`) and the same handler contract, and because two of them are the same mechanism seen twice: the resolver hook needs the caller's visible set to decide over (member 1 depends on member 3), and a resolver's answer is the same "typed refusal or a value" shape the envelope formalises (member 2).

## 2. The fact that shapes everything: the SDK checks the version with `!==`

`packages/vault-mcp-api/src/index.ts` lines 217 and 277:

```ts
if (api.apiVersion !== API_VERSION) { console.warn(...); return noop; }
```

So the day the host says `apiVersion: 2`, every satellite built against today's SDK stops registering — nine plugins go dark at once, silently except for a console line. That is the one outcome this design must not produce. Hence the rule in §6: **the SDK learns to accept a range before the host bumps**, and a member is detected by presence, never by version number. The version number becomes a floor ("this host has at least these members"), not an exact match.

## 3. Member 1 — the address-resolver hook

### Shape

```ts
// on plugin.api (host) and mirrored in vault-mcp-api
registerAddressResolver(ownerPluginId: string, resolver: AddressResolverSpec): () => void;

interface AddressResolverSpec {
  /** The ref prefix this resolver owns: `para` resolves `para:<address>`. */
  prefix: string;
  /** Decide what `ref` names, over the caller's VISIBLE notes only. Never picks among candidates. */
  resolve(ref: string, ctx: ResolveContext): ResolveResult | Promise<ResolveResult>;
}

interface ResolveContext {
  /** The notes this caller may see — the allowlist applied. A resolver decides over this list and nothing else. */
  visibleNotes(): readonly string[];
}

type ResolveResult =
  | { path: string }
  | { unresolved: true; detail?: string }
  | { ambiguous: readonly string[] };
```

### Rules, each to be pinned by a test

1. **Prefix grammar and reservation.** `prefix` matches `/^[a-z][a-z0-9-]*$/`. `uid` is reserved to the host. Every configured scheme instance id (`jd` today) is reserved to the host's own registry. A second registration for a prefix already held — by the host or by another publisher — THROWS at registration; never last-wins, never first-wins silently. The disposer is the only revocation (the seam's rule).
2. **Where it runs.** Step 1c of `resolveAndGuard`: after uid (1), after the host's scheme registry (1b), BEFORE `guardCall`. So the allowlist checks the RESOLVED path — a resolver is not a sandbox bypass. Defined over `mapPaths`, so exactly the arguments the allowlist scopes are the arguments a resolver can rewrite.
3. **The host re-checks the answer.** A returned `path` that is not in `visibleNotes()` is refused with `resolver_out_of_scope`, and the message names the ref, never the path. The resolver was given the visible set; a path outside it is a bug or an attack, and either way the host does not act on it.
4. **Refusals are typed and reuse the scheme codes.** `unresolved` → `address_unresolved`; `ambiguous` → `address_ambiguous` naming only the (visible) candidates; a resolver that throws → `resolver_error`, and the call runs nothing. A ref whose prefix has no live resolver (registered, then disposed; or never registered) → `address_unresolved`, never "treat it as a filename" — the uid rule.
5. **Budget.** A resolver is third-party code on every call's hot path. `RESOLVER_TIMEOUT_MS` (2 s, constant): on expiry the call refuses `resolver_timeout`. Nothing waits behind a stuck resolver.
6. **Disclosure.** Resolved paths fold back to their ref form in every refusal (`addressSafe`, extended with the resolver's list). The journal records `addressedAs: [{ref, path}]` exactly as for `jd:`.
7. **Trust.** Registration is accepted from any publisher but a resolver is INACTIVE until its owner's raw plugin id is listed in a new `trustedAddressResolvers` setting (default empty), disclosed in the settings tab like `trustedReadOnlyPlugins`. Reason: a resolver decides which note a write lands on; that is more authority than a read-only claim, which already needs trust. An inactive resolver's refs read as `address_unresolved` with a message naming the setting. **Open question for Nelson — see §7.**
8. **Registry privacy.** The resolver list lives in a module-level WeakMap keyed by a token only the host holds (the seam's pattern), so `app.plugins.plugins["vault-mcp"]` cannot enumerate who registered what.

### What it does NOT do

- It does not move the JD provider. `jd:` keeps resolving through the host's own registry. Moving scheme out is a follow-up issue once a satellite can express the JD provider through this hook; that is a satellite extraction with the ordinary `<owner>_<bare name>` rename tax and the S8 ruling's three host consumers (ServerCtx settings, drift source, debt source) to re-seam. Not #399.
- It does not offer allocation (`nextFree`) or listing. A resolver answers "what does this ref name"; the six read tools and three write tools stay where they are.

## 4. Member 2 — the partial-result envelope

### Shape

```ts
// vault-mcp-api
export function partial<T extends object>(data: T, message: string): Partial<T>;
// what the host sees on the wire from a handler's return value:
{ "vault-mcp-api/envelope": "partial", data: T, message: string }
```

The brand is a string-keyed property, not a class or a Symbol, because publisher and host are different bundles and `instanceof` does not cross them.

### Rules

1. A handler that returns a `partial(...)` gets `okError(data)` on the wire: `structuredContent` = `data`, `content` = the JSON text plus the message, `isError: true`. A thrown error stays `fail(err)` — text only, as today.
2. The brand is checked ONLY on the top-level return value. A `partial` nested inside `data` is data.
3. A v1 host receiving a branded object wraps it as `ok(data)` with the brand key visible — degraded but not broken. The SDK doc says so, so a publisher that needs the error bit checks `api.apiVersion >= 2` before relying on it.
4. `okError` already exists in the host (`mcp/helpers.ts`); nothing new is invented on the wire.

## 5. Member 3 — caller scope for published tools

### Shape

```ts
// the handler contract gains a SECOND positional argument; v1 handlers ignore it
handler: (args: Record<string, unknown>, ctx?: CallContext) => Promise<unknown> | unknown;

interface CallContext {
  /** Filter a list of vault paths to those this caller may see. Returns the SAME array when no allowlist is active (the host's own identity convention). */
  visible(paths: readonly string[]): readonly string[];
  /** One path. */
  isVisible(path: string): boolean;
  /** The session cannot write. A mutating tool called here was already refused by the host; this is for tools that branch. */
  readOnly: boolean;
}
```

### Rules

1. **Functions, never the list.** The allowlist is not handed over. A tool asks "may I show this" and gets yes/no; it cannot learn the boundary except by probing paths it already holds — which is the existing residual, not a new one.
2. **F3 stands.** A pathless external tool under an allowlist is STILL refused wholesale. Member 3 does not lift that: the host cannot verify a satellite applied `ctx.visible`, so it keeps refusing what it cannot scope itself. What member 3 buys is the dormant seams in bases/crosssession/skills/triage waking for the calls that DO get through (path-keyed tools whose ANSWER can name other paths — the fileclass `explain`, provenance `check` class) and for the no-allowlist case, where `visible` is identity. **This is a smaller win than the satellites' comments imply, and the doc must say so** — the comments say "re-lights it"; it re-lights the row filters, not the F3 gate.
3. `ctx` is built per call from `ctx.getSettings()` (read live, the inert-toggle rule), not snapshotted at connection build.

## 6. Sequencing — three PRs, no dark satellites

| step | package | what | apiVersion on the wire |
| --- | --- | --- | --- |
| A | `vault-mcp-api` | version check becomes `apiVersion >= API_VERSION_MIN (1)`; `partial()` helper; `CallContext` and `AddressResolverSpec` types; `registerAddressResolver` wrapper that is a no-op-with-warning when the host lacks the member | host still says 1 |
| A′ | nine satellites | rebuild against the new SDK (no code change) | 1 |
| B | host | `apiVersion: 2`; resolver registry + step 1c + `trustedAddressResolvers`; `partial` detection → `okError`; `CallContext` passed to every external handler; settings tab rows | 2 |
| C | new issue | JD provider expressed through the hook; scheme extracted to `vaultmcp-scheme` | — |

A satellite that skips A′ and meets a step-B host is refused at registration by the OLD `!==` check — loudly, in the console, the same as today's behaviour for any mismatch. So A′ is the only ordering constraint, and it is one rebuild.

The contract test (`packages/vault-mcp-api/tests/contract.test.ts`) pins each new member with `Required<>` in both directions, the way `guardedTerritories` is pinned — the `MutuallyAssignable` check is blind to optional members and was caught being blind once already (#396).

## 7. Open questions for Nelson

1. **Trust for resolvers (§3 rule 7).** A resolver chooses which note a write lands on. My pick: inactive until listed in `trustedAddressResolvers`, like read-only claims. The alternative — active on registration — is one line less friction and one more way a stray plugin redirects a write.
2. **Version floor vs capability flags.** My pick: the number is a floor and members are detected by presence. The alternative is to keep `apiVersion: 1` forever and add a `capabilities: string[]` array; it avoids the bump but every consumer then string-matches capability names, which is the same thing with worse types.
3. **Should the resolver hook ship before there is a second scheme to use it?** The S8 ruling said not to invent a hook while only the host consumes it. Member 1 has no external consumer today; its first would be the JD provider itself moving out (step C). If you would rather wait for a real second scheme, members 2 and 3 can ship as apiVersion 2 alone and member 1 becomes apiVersion 3 later — the floor rule makes that cheap.

## Decisions

**2026-09-26, Nelson, in-session: "a -- your picks."** All three §7 questions take the recommended answer:

1. **Resolver trust — inactive until listed.** A registered resolver does nothing until its owner's raw plugin id is in `trustedAddressResolvers` (default empty, disclosed in the settings tab). An inactive resolver's refs read `address_unresolved`, with the setting named.
2. **Version is a floor.** The SDK accepts `apiVersion >= 1`; members are detected by presence. No capability-flag array.
3. **The resolver hook waits.** apiVersion 2 ships members 2 and 3 (partial-result envelope, caller scope). Member 1 ships as apiVersion 3 when a second real scheme exists to consume it — the S8 rule against inventing a hook only the host uses stands. §6's step B therefore carries only `partial` detection and `CallContext`; the resolver registry, step 1c and `trustedAddressResolvers` move to a v3 issue filed when that scheme appears. Step C (moving scheme out) waits with it.
