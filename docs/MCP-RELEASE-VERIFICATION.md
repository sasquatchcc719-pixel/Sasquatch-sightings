# MCP release verification

The production domain can be reassigned by a later Vercel production deployment. A previously promoted MCP deployment is therefore not sufficient evidence that the custom domain still serves the intended release.

The checked-in `src/lib/mcp/release-manifest.json` is the single source of truth for the MCP server name, version, and ordered tool catalog. Server startup fails when the registered catalog differs from that manifest. `/mcp/about` publishes the same manifest with `Cache-Control: no-store`.

## Promotion gate

Verify a staged deployment before promotion:

```bash
pnpm mcp:verify-release -- https://STAGED-DEPLOYMENT.vercel.app
```

After promotion, verify the custom domain independently:

```bash
pnpm mcp:verify-release -- https://sightings.sasquatchcarpet.com
```

Both checks must report `sasquatch-sightings-read@1.8.1` and 50 tools. Do not refresh connector metadata until both checks pass. If the live check later fails, inspect the current domain-to-deployment mapping before changing connector metadata; a newer deployment may have replaced the alias.

Commercial workspace verification is described in `HARRY-COMMERCIAL-WORKSPACE.md`. Keep outgoing Outreach email and real measuring creation off during connector checks.
