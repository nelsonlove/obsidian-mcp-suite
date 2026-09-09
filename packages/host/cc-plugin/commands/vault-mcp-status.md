---
name: vault-mcp-status
description: Report whether the Vault MCP Obsidian bridge is live and which vault it's serving.
---

Check Vault MCP connectivity and report the result to the user:

1. Call the `mcp__vault-mcp__obsidian_doctor` tool. If that tool prefix does not
   exist in this session (a registration made between 0.12.0 and the
   host/provider split, which was named `governor`), call
   `mcp__governor__obsidian_doctor` instead.
2. **If it returns**, summarize what it reports — the bound vault, socket path, and
   plugin version — and confirm Vault MCP is live and its MCP tools are available.
3. **If the call fails or the server is unavailable**, tell the user Vault MCP is
   **down**: its MCP tools will fail this session. Fix: open Obsidian and enable
   the "Vault MCP" community plugin (Settings → Community plugins), then run
   `/mcp` and reconnect (server name `vault-mcp`; registrations made between
   0.12.0 and the host/provider split were named `governor`).
