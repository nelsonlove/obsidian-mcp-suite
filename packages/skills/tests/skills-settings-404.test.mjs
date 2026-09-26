/**
 * skills-settings-404.test.mjs — the type map and the roots are SETTINGS with
 * no shipped spelling (#404, ruled by Nelson 2026-09-26).
 *
 * The compiler hardcoded the bare frontmatter types `policy`/`agent`/`skill`/
 * `command`; the vault types by class path (`Note/AgentPolicy`, `Person/Agent`).
 * One vault's spelling baked into a plugin — the 2026-09-22 defect, same remedy:
 * the PLUGIN ships an empty type map and empty include roots (nothing compiles
 * until the operator names their classes and folders), while the KERNEL keeps an
 * identity map for its direct callers. The `~/.claude/agents` symlink loads 03.18
 * natively today, so the roots setting is also how the fleet keeps the six rank
 * files from loading twice until the switch ([C0-CC]'s word, on issue #404).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  detectKind, mappedKind, spellingFor, inRoots, collectNotes, analyzeVault, markFrontmatter,
  IDENTITY_TYPE_MAP, DEFAULT_FIELDS,
} from "../src/kernel/exporter.ts";
import {
  DEFAULT_SKILLS_CONFIG, skillsConfigOf, fieldsOf, typeMapOf, parseTypeMapLines, typeMapLines, validateSkillsConfig,
} from "../src/kernel/skills-config.ts";
import { handleNoteChanged } from "../src/export-trigger.ts";

/** A fake SkillsSource over a note list. */
function sourceOf(notes) {
  return {
    notes: async () => notes,
    resolveLink: (lp) => notes.find((n) => n.path.endsWith(`/${lp}.md`) || n.path === `${lp}.md`)?.path ?? null,
    embed: async () => null,
    basePath: () => null,
  };
}
const fm = (type, extra = {}) => ({ type, ...extra });
const VAULT_MAP = { "Note/AgentPolicy": "policy", "Person/Agent": "agent", "Note/Skill": "skill" };
const F = (over) => ({ ...DEFAULT_FIELDS, typeSource: "frontmatter", ...over });

describe("the kernel keeps an identity map; the plugin ships an empty one", () => {
  test("detectKind with no typeMap maps the bare kinds — every direct kernel caller is unchanged", () => {
    for (const k of ["skill", "agent", "policy", "command"]) assert.equal(detectKind({ type: k }, { type: k }, F({})), k);
    assert.deepEqual(IDENTITY_TYPE_MAP, { skill: "skill", agent: "agent", policy: "policy", command: "command" });
  });

  test("DEFAULT_SKILLS_CONFIG ships an EMPTY type map and EMPTY roots, and fieldsOf carries them", () => {
    assert.deepEqual(DEFAULT_SKILLS_CONFIG.typeMap, {});
    assert.deepEqual(DEFAULT_SKILLS_CONFIG.includeRoots, []);
    assert.deepEqual(DEFAULT_SKILLS_CONFIG.excludeRoots, []);
    const f = fieldsOf(skillsConfigOf({}));
    assert.deepEqual(f.typeMap, {}); assert.deepEqual(f.includeRoots, []); assert.deepEqual(f.excludeRoots, []);
  });

  test("under the shipped config NOTHING compiles, and the warnings say why — never a silent empty plugin", async () => {
    const src = sourceOf([{ path: "03 Agents/03.01 Inbox/Policies/P.md", frontmatter: fm("Note/AgentPolicy"), body: "p" }]);
    const warnings = [];
    const notes = await collectNotes(src, fieldsOf(skillsConfigOf({})), warnings);
    assert.deepEqual(notes, []);
    assert.ok(warnings.some((w) => /include roots are EMPTY/.test(w)), warnings.join("\n"));
  });
});

describe("mappedKind — the vault's spelling, exactly", () => {
  test("a mapped class path compiles as its kind; the bare kind does NOT when the map omits it; case and shape matter", () => {
    assert.equal(mappedKind("Note/AgentPolicy", VAULT_MAP), "policy");
    assert.equal(mappedKind("policy", VAULT_MAP), null, "the bare spelling is not in this vault's map");
    assert.equal(mappedKind("note/agentpolicy", VAULT_MAP), null, "a class path is an identifier — case-sensitive");
    assert.equal(mappedKind(["Note/AgentPolicy"], VAULT_MAP), null, "a list never matches");
    assert.equal(mappedKind(undefined, VAULT_MAP), null);
  });

  test("an unmapped type is skipped and reported ONCE per spelling with a count; an unrelated class is not counted", async () => {
    const src = sourceOf([
      { path: "P1.md", frontmatter: fm("Note/AgentPolicy"), body: "" },
      { path: "P2.md", frontmatter: fm("Note/AgentPolicy"), body: "" },
      { path: "P3.md", frontmatter: fm("Note/AgentPolicy"), body: "" },
      { path: "T.md", frontmatter: fm("Task/Decision"), body: "" },
      { path: "S.md", frontmatter: fm("Note/Skill"), body: "" },
    ]);
    const warnings = [];
    const notes = await collectNotes(src, F({ typeMap: { "Note/Skill": "skill" } }), warnings);
    assert.deepEqual(notes.map((n) => n.path), ["S.md"]);
    const unmappedLines = warnings.filter((w) => /does not name/.test(w));
    assert.equal(unmappedLines.length, 1, warnings.join("\n"));
    assert.match(unmappedLines[0], /3 note\(s\) carry type 'Note\/AgentPolicy'/);
    assert.ok(!warnings.some((w) => /Task\/Decision/.test(w)), "a class that is not agent/skill/policy/command-shaped is not a candidate");
  });
});

describe("inRoots — one boundary rule, the host's", () => {
  test("absent include roots read the whole vault; EMPTY include roots read nothing", () => {
    assert.equal(inRoots("Any/where.md", undefined), true);
    assert.equal(inRoots("Any/where.md", []), false);
  });

  test("segment boundary: `03 Agents/03.18 Claude Code agents` covers itself, not `03.180 …`; a trailing slash means exactly that folder", () => {
    const r = ["03 Agents/03.18 Claude Code agents"];
    assert.equal(inRoots("03 Agents/03.18 Claude Code agents/captain.md", r), true);
    assert.equal(inRoots("03 Agents/03.180 Other/x.md", r), false);
    assert.equal(inRoots("03 Agents/03.18 Claude Code agents (old)/x.md", r), true, "a space is a boundary — over-inclusion is the safe direction, as for territories");
    assert.equal(inRoots("03 Agents/03.18 Claude Code agents (old)/x.md", ["03 Agents/03.18 Claude Code agents/"]), false);
    // The cases a plain string-prefix match gets WRONG — the root is a character
    // prefix of the path, and the boundary rule is what says no (or yes).
    assert.equal(inRoots("03 Agents/03.180 Other/x.md", ["03 Agents/03.18"]), false, "a digit continues the name: 03.18 does not cover 03.180");
    assert.equal(inRoots("03 Agents/03.18 Claude Code agents/captain.md", ["03 Agents/03.18"]), true, "a space ends the name: 03.18 covers 03.18 Claude Code agents");
    assert.equal(inRoots("03 agents/03.18 claude code agents/captain.md", r), true, "case-insensitive, as territories are");
  });

  test("an exclude root wins over an include root", () => {
    assert.equal(inRoots("03 Agents/03.18 Claude Code agents/captain.md", ["03 Agents"], ["03 Agents/03.18 Claude Code agents"]), false);
    assert.equal(inRoots("03 Agents/03.01 Inbox/Agents/a.md", ["03 Agents"], ["03 Agents/03.18 Claude Code agents"]), true);
  });

  test("collectNotes reads only inside the roots — a typed note outside is neither compiled nor counted as unmapped", async () => {
    const src = sourceOf([
      { path: "In/A.md", frontmatter: fm("Person/Agent", { name: "a" }), body: "" },
      { path: "Out/B.md", frontmatter: fm("Person/Agent", { name: "b" }), body: "" },
      { path: "Out/C.md", frontmatter: fm("Note/Other"), body: "" },
    ]);
    const warnings = [];
    const notes = await collectNotes(src, F({ typeMap: VAULT_MAP, includeRoots: ["In"] }), warnings);
    assert.deepEqual(notes.map((n) => n.path), ["In/A.md"]);
    assert.equal(warnings.length, 0, warnings.join("\n"));
  });

  test("a parent OUTSIDE the roots is a broken edge reported as an error — the roots never silently sever the tree", async () => {
    // Obsidian resolves the wikilink whether or not the target was compiled, so
    // the compile sees a parent path it never read: that must be an error naming
    // the child, not an agent quietly re-hung on the synthesized root.
    const src = sourceOf([
      { path: "In/child.md", frontmatter: fm("Person/Agent", { name: "child", parent: "[[boss]]" }), body: "" },
      { path: "Out/boss.md", frontmatter: fm("Person/Agent", { name: "boss" }), body: "" },
    ]);
    const a = await analyzeVault(src, F({ typeMap: VAULT_MAP, includeRoots: ["In"] }));
    assert.ok(a.errors.some((e) => /^In\/child\.md: unresolved parent/.test(e)), a.errors.join("\n"));
    assert.ok(!a.tree.some((n) => n.name === "boss"), "the outside parent is not compiled");
  });
});

describe("mark writes the VAULT'S spelling", () => {
  test("spellingFor is the reverse map; markFrontmatter sets `type` to it", () => {
    assert.equal(spellingFor("policy", VAULT_MAP), "Note/AgentPolicy");
    assert.equal(spellingFor("command", VAULT_MAP), null);
    const r = markFrontmatter({ type: "policy" }, F({ typeMap: VAULT_MAP }));
    assert.equal(r.set.type, "Note/AgentPolicy");
  });

  test("a kind the map does not spell cannot be marked — refused, never guessed", () => {
    assert.throws(() => markFrontmatter({ type: "command" }, F({ typeMap: VAULT_MAP })), /names no vault spelling for 'command'/);
  });

  test("with no typeMap the kernel writes the bare kind, as before", () => {
    assert.equal(markFrontmatter({ type: "agent" }, F({})).set.type, "agent");
  });
});

describe("config coercion, the settings-tab line format, validation", () => {
  test("typeMapOf keeps only string→kind entries", () => {
    assert.deepEqual(typeMapOf({ "Note/AgentPolicy": "policy", " ": "agent", "X": "nope", "Y": 3 }), { "Note/AgentPolicy": "policy" });
    assert.deepEqual(typeMapOf("policy"), {}); assert.deepEqual(typeMapOf(["policy"]), {}); assert.deepEqual(typeMapOf(null), {});
  });

  test("parseTypeMapLines / typeMapLines round-trip, and report each bad line", () => {
    const text = "Note/AgentPolicy = policy\n  Person/Agent=agent \n\nbad line\nX = nope\n = skill";
    const { map, problems } = parseTypeMapLines(text);
    assert.deepEqual(map, { "Note/AgentPolicy": "policy", "Person/Agent": "agent" });
    assert.equal(problems.length, 3, problems.join("\n"));
    assert.deepEqual(parseTypeMapLines(typeMapLines(map)).map, map);
  });

  test("roots are resolved like territories: trimmed, blanks and non-strings dropped, leading slash stripped", () => {
    const c = skillsConfigOf({ includeRoots: [" /03 Agents ", "", null, 4], excludeRoots: ["./00.11 Templates/"] });
    assert.deepEqual(c.includeRoots, ["03 Agents"]);
    assert.deepEqual(c.excludeRoots, ["00.11 Templates/"]);
  });

  test("validateSkillsConfig names an empty map and empty roots as the reason nothing compiles, and each bad map entry", () => {
    const p0 = validateSkillsConfig({});
    assert.ok(p0.some((x) => /type map is EMPTY/.test(x)), p0.join("\n"));
    assert.ok(p0.some((x) => /include roots are EMPTY/.test(x)), p0.join("\n"));
    const p1 = validateSkillsConfig({ typeMap: { "A": "nope", " ": "agent", "B": "agent" }, includeRoots: ["X"] });
    assert.ok(p1.some((x) => /'A' → 'nope'/.test(x)));
    assert.ok(p1.some((x) => /blank vault type/.test(x)));
    assert.ok(!p1.some((x) => /type map is EMPTY/.test(x)), "one valid entry means the map is not empty");
    assert.ok(!p1.some((x) => /include roots are EMPTY/.test(x)));
    const p2 = validateSkillsConfig({ typeSource: "tags", includeRoots: ["X"] });
    assert.ok(!p2.some((x) => /type map is EMPTY/.test(x)), "tags mode does not use the map");
  });
});

describe("the switch — the test the fleet runs before retiring the ~/.claude/agents symlink", () => {
  const RANKS = ["captain", "commander", "lieutenant-commander", "lieutenant-commander-repository", "lieutenant", "lieutenant-repository"];
  const R = "03 Agents/03.18 Claude Code agents";
  // The names the compile read from the vault: every tree node except the
  // synthesized root (the one node with no parent when no note is `root: true`).
  const compiledNames = (a) => a.tree.filter((n) => n.parent !== null).map((n) => n.name).sort();
  const vault = sourceOf([
    { path: `${R}/03.18 Claude Code agents.md`, frontmatter: { type: "Collection" }, body: "folder note — no name, not an agent" },
    ...RANKS.map((r) => ({ path: `${R}/${r}.md`, frontmatter: fm("Person/Agent", { name: r, description: `the ${r}` }), body: `${r} duties` })),
    { path: `${R}/Promotion and demotion of sessions.md`, frontmatter: { type: "Note" }, body: "proposal, not an agent" },
    { path: "03 Agents/03.01 Inbox/Agents/divorce-agent.md", frontmatter: fm("Person/Agent", { name: "divorce-agent" }), body: "scope agent" },
    { path: "00 System management/00.11 Templates/Template, Person%2FAgent.md", frontmatter: fm("Person/Agent", { name: "template" }), body: "" },
  ]);

  test("include roots = [03.18] with `Person/Agent = agent` compiles EXACTLY the six ranks — nothing else in that folder, nothing outside it", async () => {
    const a = await analyzeVault(vault, F({ typeMap: { "Person/Agent": "agent" }, includeRoots: [R] }));
    // No rank note carries `root: true`, so the compiler synthesizes the root
    // agent ("vault", parent null) and hangs the six ranks under it: that is one
    // agent more than the ranks, and it is the ONLY extra one.
    assert.equal(a.counts.agents, RANKS.length + 1, JSON.stringify(a.counts));
    assert.deepEqual(compiledNames(a), [...RANKS].sort());
    assert.equal(a.errors.length, 0, a.errors.join("\n"));
  });

  test("before the switch: include roots = [03 Agents] with 03.18 EXCLUDED compiles the inbox agent and NOT the ranks (which Claude Code loads natively)", async () => {
    const a = await analyzeVault(vault, F({ typeMap: { "Person/Agent": "agent" }, includeRoots: ["03 Agents"], excludeRoots: [R] }));
    assert.deepEqual(compiledNames(a), ["divorce-agent"]);
  });

  test("the template folder is never inside the roots the operator would name, so the template is not compiled", async () => {
    const a = await analyzeVault(vault, F({ typeMap: { "Person/Agent": "agent" }, includeRoots: ["03 Agents"] }));
    assert.ok(!a.tree.some((n) => n.name === "template"));
  });
});

describe("export-on-save honours the roots", () => {
  const deps = (path, includeRoots) => {
    let requested = 0;
    handleNoteChanged({ path }, {
      isEnabled: () => true,
      fields: () => F({ typeMap: VAULT_MAP, includeRoots }),
      getFrontmatter: () => fm("Note/AgentPolicy"),
      requestExport: () => { requested += 1; },
    });
    return requested;
  };
  test("a typed note INSIDE the roots requests an export; the same note OUTSIDE does not", () => {
    assert.equal(deps("In/P.md", ["In"]), 1);
    assert.equal(deps("Out/P.md", ["In"]), 0);
  });
});
