# Copy the notes named in export.json (from export-sample.js) into <temp>/vault-mcp-damage/vault/.
# Usage: python3 copy-sample.py <vault path>. Reads the vault; writes only the temp folder.
import json, os, shutil, sys, tempfile

vault = sys.argv[1]
d = os.path.join(tempfile.gettempdir(), "vault-mcp-damage")
e = json.load(open(os.path.join(d, "export.json")))
for p in e["entries"]:
    dst = os.path.join(d, "vault", p)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(os.path.join(vault, p), dst)
print("copied", len(e["entries"]), "notes to", os.path.join(d, "vault"))
