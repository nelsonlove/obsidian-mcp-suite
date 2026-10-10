// #500: obsidian_write_note's `frontmatter` and strict input schemas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { renderNoteWithFrontmatter, opensWithFrontmatter, jsonFlowYaml } from "../src/note-frontmatter.ts";
import { strictInput, inputShapeOf, inputObjectOf, extendInput, isObjectSchema } from "../src/strict-input.ts";

test("renderNoteWithFrontmatter: fence, yaml, fence, body; empty frontmatter is the body alone", () => {
  const y = (o) => Object.entries(o).map(([k, v]) => `${k}: ${v}`).join("\n");
  assert.equal(renderNoteWithFrontmatter({ a: 1 }, "body", y), "---\na: 1\n---\nbody");
  assert.equal(renderNoteWithFrontmatter({}, "body", y), "body");
});

test("opensWithFrontmatter reads a fence as the accept guard does", () => {
  assert.equal(opensWithFrontmatter("---\na: 1\n---\nx"), true);
  assert.equal(opensWithFrontmatter("﻿---\na: 1\n---\nx"), true);
  assert.equal(opensWithFrontmatter("# x\n---\na: 1\n---"), false);
  assert.equal(opensWithFrontmatter("---\nno close"), false);
});

test("jsonFlowYaml: plain words bare, everything else as JSON, which YAML reads back unchanged", () => {
  const out = jsonFlowYaml({
    title: "A note",
    reserved: "yes",
    number_like: "12",
    colon: "a: b",
    multi: "line\nbreak",
    n: 3,
    b: false,
    nil: null,
    list: ["x", 1],
    obj: { k: "v" },
    "odd key": "v",
    skip: undefined,
  });
  assert.equal(
    out,
    'title: A note\nreserved: "yes"\nnumber_like: "12"\ncolon: "a: b"\nmulti: "line\\nbreak"\nn: 3\nb: false\nnil: null\nlist: ["x",1]\nobj: {"k":"v"}\n"odd key": v\n',
  );
  assert.equal(jsonFlowYaml({}), "");
});

test("strictInput refuses an unknown argument; extendInput keeps it strict; a raw shape stays a shape", () => {
  const s = strictInput({ path: z.string() });
  assert.throws(() => s.parse({ path: "a", extra: 1 }), /Unrecognized key/);
  const ext = extendInput(s, { if_rev: z.number().optional() });
  assert.ok(isObjectSchema(ext));
  assert.equal(ext.parse({ path: "a", if_rev: 1 }).if_rev, 1);
  assert.throws(() => ext.parse({ path: "a", extra: 1 }), /Unrecognized key/);
  assert.deepEqual(Object.keys(inputShapeOf(ext)), ["path", "if_rev"]);

  const raw = extendInput({ path: z.string() }, { if_rev: z.number().optional() });
  assert.equal(isObjectSchema(raw), false);
  assert.deepEqual(Object.keys(raw), ["path", "if_rev"]);
  // The non-strict default still strips, as the SDK always has.
  assert.deepEqual(inputObjectOf(raw).parse({ path: "a", extra: 1 }), { path: "a" });
});
