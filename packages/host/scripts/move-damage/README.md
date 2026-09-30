# Move damage test on a copy of a real vault

`tests/move-damage-copy.test.mjs` moves real notes on an in-memory copy of a vault and checks every note for damage. It needs two things, made in two steps. Neither step writes to the vault.

1. **Export Obsidian's own link index for a sample (read-only).** Run `export-sample.js` inside the running Obsidian, for example with `obsidian eval vault=<name> code="$(cat export-sample.js)"` from inside the vault. It picks 50 target notes (the 20 most linked, and 30 spread across the rest), and writes every backlink's text, offsets and Obsidian's own resolution of it, plus the vault's path list, to `<system temp>/vault-mcp-damage/export.json`. It skips `80-89 …` and `_inboxes/`; edit the `guarded` line for another vault's guarded areas.
2. **Copy the notes it names.** `python3 copy-sample.py <vault path>` copies each note in the export into `<system temp>/vault-mcp-damage/vault/`.

Then run the test:

```sh
VAULT_MCP_DAMAGE_DIR="$(python3 -c 'import tempfile,os;print(os.path.join(tempfile.gettempdir(),"vault-mcp-damage"))')" \
  node --import tsx --test tests/move-damage-copy.test.mjs
```

Set `VAULT_MCP_DAMAGE_DIAG=1` to write the details of any failure to `diag/` beside the export. Delete the folder when done: it holds a copy of your notes.
