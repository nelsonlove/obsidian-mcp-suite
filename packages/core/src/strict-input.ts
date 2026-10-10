/**
 * Strict input schemas (#500).
 *
 * A tool's input schema is a zod RAW SHAPE almost everywhere in this repo, and
 * the MCP SDK wraps a raw shape in `z.object(shape)`, which STRIPS an argument
 * the shape does not name: the call runs as if the argument were never sent.
 * For `obsidian_write_note` that lost data: a caller passed `frontmatter` before
 * the tool had it, and `content` was written as the whole note.
 *
 * A tool registered with `strictInput(shape)` instead refuses an unknown
 * argument with a validation error. Code that adds to or reads a schema
 * (the host's kernel arguments, code mode, the tool runner) reads both forms
 * through `inputShapeOf` / `inputObjectOf` / `extendInput`, so a strict
 * schema stays strict when the host adds `if_rev` and `idempotency_key`.
 */

import { z } from "zod";

export type InputShape = Record<string, z.ZodTypeAny>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type InputSchema = InputShape | z.ZodObject<any, any, any>;

/** A zod object schema (duck-typed, so two copies of zod still agree). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isObjectSchema(s: unknown): s is z.ZodObject<any, any, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!s && typeof s === "object" && (s as any)._def?.typeName === "ZodObject";
}

/** `z.object(shape).strict()`: an argument the shape does not name is refused. */
export function strictInput(shape: InputShape): z.ZodObject<InputShape, "strict"> {
  return z.object(shape).strict();
}

/** The raw shape of either form. */
export function inputShapeOf(s: InputSchema | undefined): InputShape {
  if (isObjectSchema(s)) return s.shape as InputShape;
  return s ?? {};
}

/** The object schema of either form (a raw shape becomes the SDK's own non-strict `z.object`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function inputObjectOf(s: InputSchema | undefined): z.ZodObject<any, any, any> {
  return isObjectSchema(s) ? s : z.object(s ?? {});
}

/** Add fields to either form, keeping the form: a strict object stays strict. */
export function extendInput(s: InputSchema | undefined, extra: InputShape): InputSchema {
  if (isObjectSchema(s)) return s.extend(extra);
  return { ...(s ?? {}), ...extra };
}
