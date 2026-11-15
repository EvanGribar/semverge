# SemVerge agent plugin

The plugin bundles two workflows and connects them to SemVerge through Streamable HTTP. The local pilot reads the public SemVerge repository.

1. Configure the MCP token digest and start the Cloud app on port 3000 using the [Cloud setup instructions](../../cloud/README.md).
2. Set `SEMVERGE_MCP_TOKEN` to the original token in the environment that launches Codex.
3. From the repository root, install the plugin from the repository marketplace:

   ```sh
   codex plugin add semverge@semverge-repo
   ```

   If CLI marketplace discovery needs explicit registration, run `codex plugin marketplace add .` first. In Codex desktop, open the Plugins Directory and choose the SemVerge repository marketplace.

4. Open a new session and ask “Brief me on the next release” or “Explain what is blocking the next release.” The workflows cite the GitHub PR or release returned by MCP.

The Codex MCP configuration reads the bearer token from the environment. Other compatible local clients can use the portable manifest and provide the same token through their credential settings. Keep the token out of package files. A hosted client requires a separately reachable, configured SemVerge endpoint.
