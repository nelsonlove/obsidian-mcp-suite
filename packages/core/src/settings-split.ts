// THE SETTINGS SPLIT — which of the pre-split plugin's `data.json` keys belong
// to the host and which to the governance provider (suite split, S3c).
//
// Published here rather than declared twice, on the `isVisible` / `resolveScope`
// / `scanForAcceptFence` precedent. Two copies of this table is how one vault
// ends up with a key both plugins claim (each overwriting the other's edit) or
// a key neither claims (silently dropped on the first save after the split).
// One table, two consumers, and a test that proves the halves are disjoint.
//
// WHAT THIS IS NOT. It is not a migration, and it moves nothing. Both plugins
// read the SAME pre-split `data.json` — the provider keeps the folder and the
// file, and the host COPIES the host half out of it once, on its first load,
// never writing back. The provider's own saves merge over whatever is already
// in the file rather than replacing it, so a rollback to the single-plugin
// build finds every key it ever wrote still there. That is why the two lists
// have to agree about the whole shape, and why the union is pinned.

/**
 * The keys the HOST owns after the split. Everything the transport, the guard,
 * the kernel, the module host and observation capture read.
 *
 * `vocabularies` is here because it was already migration-only when the read
 * tier left (the `vault-vocab` satellite adopts from it and nothing in the
 * suite reads it); it stays on the HOST side because that is where the
 * satellite looks for it.
 */
export const HOST_SETTING_KEYS = [
  "setupAcknowledged",
  "readOnly",
  "allowlist",
  "enabled",
  "allowDangerousCli",
  "rawCliProxy",
  "trustedReadOnlyPlugins",
  "protectedProperties",
  "vocabularies",
  "schemes",
  "modules",
  "cliPolicy",
  "enforceRecordImmutability",
  "captureObservations",
  "captureMaxBytes",
  "devToolRunner",
] as const;

/**
 * The keys the PROVIDER owns after the split.
 *
 * `historyEnabled` / `historyScope` were host settings while the two halves
 * shipped as one artifact, and they were always the provider's facts: the Git
 * history store, its scope, and the D10 decision to record at all belong to
 * whoever owns the standing chain. Nothing host-side ever read them except the
 * composition root that built the provider's proposal observer.
 */
export const PROVIDER_SETTING_KEYS = ["historyEnabled", "historyScope"] as const;

/**
 * Module rows the PROVIDER owns. `modules` itself is a HOST key — the module
 * host is the host's — but the `acceptance` row's `enabled` flag and `config`
 * block describe the review pane, the badge display and the `accepted-by`
 * identity, all of which are provider surface. So the row travels with the
 * provider while the map stays with the host.
 *
 * Consequence, stated because it is easy to trip over: after the split the
 * host's module registry declares ONE capability module (`scheme`), and a
 * surviving `modules.acceptance` row in the host's copy of `data.json` is an
 * unknown id — reported by the module host's skip-and-report, not mounted.
 */
export const PROVIDER_MODULE_IDS = ["acceptance"] as const;

export type HostSettingKey = (typeof HOST_SETTING_KEYS)[number];
export type ProviderSettingKey = (typeof PROVIDER_SETTING_KEYS)[number];

type Row = Record<string, unknown>;

function pick(raw: Row, keys: readonly string[]): Row {
  const out: Row = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(raw, k)) out[k] = raw[k];
  return out;
}

/**
 * Split one pre-split settings object into the two halves.
 *
 * NEITHER HALF IS DESTRUCTIVE and neither is authoritative over the file: this
 * is a read, and the caller decides what to persist where. Unknown keys — a
 * hand-edited `data.json`, a setting a newer build added — land in NEITHER
 * half, which is deliberate: a key nobody claims must not be silently adopted
 * by whichever plugin happens to save first. The provider's merge-on-save keeps
 * them in the file regardless.
 *
 * `modules` is split by ROW: the host half keeps every row except the
 * provider's, and the provider half receives only its own rows, flattened into
 * `acceptanceModule` so the provider never has to carry the host's module map
 * shape.
 */
export function splitSettings(raw: unknown): {
  host: Row;
  provider: Row & { acceptanceModule?: unknown };
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { host: {}, provider: {} };
  const row = raw as Row;
  const host = pick(row, HOST_SETTING_KEYS);
  const provider: Row & { acceptanceModule?: unknown } = pick(row, PROVIDER_SETTING_KEYS);

  const modules = row.modules;
  if (modules && typeof modules === "object" && !Array.isArray(modules)) {
    const src = modules as Row;
    const hostModules: Row = {};
    for (const [id, value] of Object.entries(src)) {
      if ((PROVIDER_MODULE_IDS as readonly string[]).includes(id)) provider.acceptanceModule = value;
      else hostModules[id] = value;
    }
    host.modules = hostModules;
  }
  return { host, provider };
}
