// TYPED REFUSALS ACROSS THE PUBLISHING BOUNDARY.
//
// While these tools were registered inside the host they returned
// `codedError(code, detail)` — `ok()`'s shape plus `isError: true`, rendering as
// `Error [code]: detail`. The publishing contract has no return-an-error form: a
// returned object is `ok(data)` and a throw is `fail(err)`. But `fail()` reads a
// lowercase-snake `code` off the thrown error and renders exactly the same
// string, so a THROWN typed refusal is byte-compatible with what these tools
// produced before the split.
//
// That is not true of every envelope — the fileclass satellite's structured
// `okError` report could not cross and had to become a success carrying
// `succeeded: false` — so it is worth stating plainly which case this is: every
// refusal here (`not_revising`, `accept_forbidden`, `not_found`,
// `invalid_path`, `out_of_allowlist`, `no_session`, and the mandate store's own
// codes) carries no structured payload beyond its code and message, so nothing
// was lost in the move.

export class GovernanceRefusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GovernanceRefusal";
    this.code = code;
  }
}

export function refuse(code: string, message: string): never {
  throw new GovernanceRefusal(code, message);
}
