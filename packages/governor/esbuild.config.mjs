import esbuild from "esbuild";

const production = process.argv.includes("production");

// No build-time defines and no embedded assets. THE BRIDGE IS THE HOST'S: it is
// the transport's stdio front end, embedded into the host's `main.js` via
// `__BRIDGE_SOURCE__` and written to `~/.claude/vault-mcp/` on load. A second
// copy shipped from here would be a second writer of the same file, which is
// exactly the class of drift the suite split exists to remove.
await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian", "electron", "@codemirror/state", "@codemirror/view",
    "@lezer/common", "node:net", "node:fs", "node:os", "node:path",
  ],
  format: "cjs",
  platform: "node",
  target: "es2022",
  outfile: "main.js",
  sourcemap: production ? false : "inline",
  minify: production,
  logLevel: "info",
});
