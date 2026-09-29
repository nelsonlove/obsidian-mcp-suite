# count-required-kernel-args.py: Nelson's 01.43 "a" (2026-09-29). Counts the host write journal's governed writes that would be refused if if_rev / idempotency_key were required per operation.
# The classification in need() is the suite session's reading until the 01.33 register lands. Run: python3 scripts/count-required-kernel-args.py (reads ~/obsidian/.obsidian/plugins/vault-mcp/journal).
import json, glob, collections, datetime
recs = [json.loads(l) for f in sorted(glob.glob('/Users/nelson/obsidian/.obsidian/plugins/vault-mcp/journal/*.jsonl')) for l in open(f) if l.strip()]
# Only the operation's own records (deduped replays and late corrections are not calls).
calls = [r for r in recs if r.get("outcome") in ("ok", "error", "conflict") and "corrects" not in r]
now = datetime.datetime.now(datetime.timezone.utc)
def ts(r): return datetime.datetime.fromisoformat(r["ts"].replace("Z", "+00:00"))

def need(r):
    """(needs_if_rev, needs_key, bucket) under 01.43 "a", my reading; None = unclassified."""
    op, a = r["op"], r.get("argsDigest") or {}
    if not isinstance(a, dict): a = {}
    ov = a.get("overwrite")
    if op in ("obsidian_write_note", "obsidian_write_notes"):
        if ov is False: return (False, False, "create-if-absent")
        return (True, False, "overwrite (idempotent, changes read content)")
    if op == "obsidian_manage_frontmatter":
        if a.get("op") in ("append", "add", "push"): return (True, True, "frontmatter list append")
        return (True, False, "frontmatter set/delete")
    if op == "obsidian_patch_note":
        if a.get("op") in ("append", "prepend"): return (True, True, "patch append/prepend")
        return (True, False, "patch replace")
    if op in ("obsidian_append_note", "obsidian_append_at_heading", "crosssession_post"):
        return (False, True, "append")
    if op in ("obsidian_run_command",):
        return (False, True, "command (not idempotent)")
    if op in ("obsidian_move_note", "obsidian_move_notes", "obsidian_trash", "obsidian_delete_note", "obsidian_cli",
              "obsidian_repoint_link", "obsidian_assign_address", "obsidian_renumber_address", "obsidian_refile_address", "obsidian_quickadd_compile"):
        return None
    return "out"  # kernel claims, plugin toggles, UI navigation, attest: not vault writes

def who(r):
    a = r.get("actor") or {}
    return a.get("session") or (a.get("client", "?") + "#" + a.get("connection", "?"))

for label, sel in (("LAST 7 DAYS", [r for r in calls if ts(r) > now - datetime.timedelta(days=7)]), ("WHOLE JOURNAL", calls)):
    print(f"\n==== {label}: {len(sel)} calls ({sel[0]['ts'][:10] if sel else '-'} .. {sel[-1]['ts'][:10] if sel else '-'})")
    refused = collections.Counter(); by_who = collections.Counter(); by_bucket = collections.Counter()
    governed = 0; unclassified = collections.Counter(); reasons = collections.Counter()
    for r in sel:
        n = need(r)
        if n == "out": continue
        if n is None:
            unclassified[(r["op"], bool(r.get("ifRev")), bool(r.get("idempotencyKey")))] += 1; continue
        governed += 1
        rv, key, bucket = n
        miss = []
        if rv and not r.get("ifRev"): miss.append("if_rev")
        if key and not r.get("idempotencyKey"): miss.append("idempotency_key")
        if miss:
            refused[r["op"]] += 1; by_who[who(r)] += 1; by_bucket[bucket] += 1; reasons["+".join(miss)] += 1
    print(f"governed (classified) writes: {governed}; would be REFUSED: {sum(refused.values())}")
    print(" by op:", dict(refused.most_common()))
    print(" by missing argument:", dict(reasons))
    print(" by kind:", dict(by_bucket.most_common()))
    print(f" by caller ({len(by_who)} distinct; top 8):")
    for w, c in by_who.most_common(8): print(f"   {c:5}  {w}")
    print(" unclassified ops (op, had if_rev, had key): count")
    for k, c in unclassified.most_common(): print("  ", k, c)
