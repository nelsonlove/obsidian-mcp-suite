// THE VAULT SLUG — one vault, one slug, in every plugin of the suite.
//
// Published at the host/provider split (S3c). The host names its socket, its
// discovery json and its observation directory by this slug; the governance
// provider names its history repository — `~/.claude/governor/history/<slug>/`
// — by the same one. Two implementations that disagreed by a single character
// would point the standing chain's git directory somewhere the store-binding
// marker does not name, and the vault would read as "cut over elsewhere; chain
// absent here" on a machine that is holding the chain.
//
// That is the `isVisible` / `resolveScope` argument at its sharpest: this is
// not a shared utility kept in one place for tidiness, it is an identity
// function whose two callers must produce the same answer or the product is
// wrong in a way nobody notices until disaster recovery.

export function vaultSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
