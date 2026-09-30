(() => {
  // READ-ONLY: export Obsidian's own link index for a sample of notes, as ground
  // truth for the copy-vault damage test. Writes JSON OUTSIDE the vault, to <system temp>/vault-mcp-damage/.
  // 80-89 Sensitive (a guarded territory) is excluded from every part of it.
  const DIR = require("path").join(require("os").tmpdir(), "vault-mcp-damage");
  const OUT = require("path").join(DIR, "export.json");
  const guarded = (p) => /^80-89 /.test(p) || p.startsWith("_inboxes/");
  const mc = app.metadataCache;
  const md = app.vault.getMarkdownFiles().filter((f) => !guarded(f.path));
  // backlink counts per target
  const inbound = new Map();
  for (const [src, targets] of Object.entries(mc.resolvedLinks)) {
    if (guarded(src)) continue;
    for (const [t, n] of Object.entries(targets)) if (t.endsWith(".md") && !guarded(t)) inbound.set(t, (inbound.get(t) || 0) + n);
  }
  const ranked = [...inbound.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 20).map(([t]) => t);
  // a deterministic spread: every Nth note with 1..30 backlinks
  const mid = ranked.filter(([, n]) => n >= 1 && n <= 30);
  const spread = mid.filter((_, i) => i % Math.max(1, Math.floor(mid.length / 30)) === 0).slice(0, 30).map(([t]) => t);
  const targets = [...new Set([...top, ...spread])];
  const sources = new Set();
  for (const [src, ts] of Object.entries(mc.resolvedLinks)) {
    if (guarded(src)) continue;
    if (targets.some((t) => ts[t])) sources.add(src);
  }
  const files = new Set([...targets, ...sources]);
  const entry = (p) => {
    const f = app.vault.getAbstractFileByPath(p);
    const c = mc.getFileCache(f) || {};
    const res = (lp) => { const d = mc.getFirstLinkpathDest(lp, p); return d ? d.path : null; };
    const map = (l) => ({ link: l.link, original: l.original, start: l.position.start.offset, end: l.position.end.offset, to: res(l.link.split("#")[0]) });
    return {
      stat: { mtime: f.stat.mtime, size: f.stat.size },
      cache: mc.fileCache[p] ? { mtime: mc.fileCache[p].mtime, size: mc.fileCache[p].size } : null,
      links: (c.links || []).map(map),
      embeds: (c.embeds || []).map(map),
      frontmatterLinks: (c.frontmatterLinks || []).map((l) => ({ key: l.key, link: l.link, original: l.original, to: res(l.link.split("#")[0]) })),
    };
  };
  const out = {
    exported: new Date().toISOString(),
    newLinkFormat: app.vault.getConfig("newLinkFormat"),
    useMarkdownLinks: app.vault.getConfig("useMarkdownLinks"),
    allPaths: app.vault.getMarkdownFiles().map((f) => f.path).filter((p) => !guarded(p)),
    targets,
    entries: Object.fromEntries([...files].map((p) => [p, entry(p)])),
  };
  const fs = require("fs");
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  return JSON.stringify({ targets: targets.length, files: files.size, allPaths: out.allPaths.length, newLinkFormat: out.newLinkFormat, useMarkdownLinks: out.useMarkdownLinks });
})()
