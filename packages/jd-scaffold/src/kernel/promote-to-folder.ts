// Ported from obsidian-jd-dashboard's src/commands/promote-to-folder.ts, split
// into PLAN (pure, here) and APPLY (src/tools.ts). The original operated on
// Obsidian's "currently active file"; the tool takes an explicit note path
// argument instead — matching every other Governor write tool, none of which
// depend on editor focus state. (The ARGUMENT is spelled `note_path` on the
// wire since the extraction; this planner's own field stays `path` because it
// is not an argument name — see CLAUDE.md's allowlist-posture bullet.)

import type { PlanPromoteInput, PromoteToFolderPlan } from "./types.js";

const ID_RE = /^(\d{2}\.\d{2}|\d{5})\s+(.+)$/;

export function planPromoteToFolder(input: PlanPromoteInput): PromoteToFolderPlan {
  const { path, exists } = input;
  const slash = path.lastIndexOf("/");
  const basename = (slash === -1 ? path : path.slice(slash + 1)).replace(/\.md$/, "");
  const parentPath = slash === -1 ? "" : path.slice(0, slash);
  const parentName = parentPath === "" ? "" : parentPath.slice(parentPath.lastIndexOf("/") + 1);

  if (!ID_RE.test(basename)) return { ok: false, reason: "not_id_note" };
  if (basename === parentName) return { ok: false, reason: "already_cover_note" };

  const folderPath = parentPath ? `${parentPath}/${basename}` : basename;
  if (exists(folderPath)) return { ok: false, reason: "folder_exists" };

  const fileName = path.slice(slash + 1);
  const newFilePath = `${folderPath}/${fileName}`;
  return { ok: true, folderPath, newFilePath };
}
