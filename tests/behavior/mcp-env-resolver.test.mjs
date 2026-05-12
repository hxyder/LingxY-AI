import assert from "node:assert/strict";
import test from "node:test";
import {
  describeMcpEnvRequirements,
  resolveMcpEnv
} from "../../src/service/capabilities/mcp/env-resolver.mjs";
import {
  clearMcpCommandExistsCacheForTests,
  commandExists,
  createConfiguredMCPServer
} from "../../src/service/capabilities/mcp/configured.mjs";
import {
  connectMcpServer,
  disconnectAll,
  getMcpSkipReason
} from "../../src/service/capabilities/mcp/client-bridge.mjs";
import { buildAIIntegrationRegistries } from "../../src/service/ai/integrations/runtime.mjs";

// ── Pure resolver ────────────────────────────────────────────────────────────

test("resolveMcpEnv passes literal strings through unchanged", () => {
  const result = resolveMcpEnv({ MODE: "fast", REGION: "us" });
  assert.deepEqual(result, {
    ok: true,
    env: { MODE: "fast", REGION: "us" },
    missing: []
  });
});

test("resolveMcpEnv resolves ${env:NAME} from the supplied env map, never falling back implicitly", () => {
  const result = resolveMcpEnv(
    { TOKEN: "${env:BRAVE_API_KEY}", PLAIN: "literal" },
    { processEnv: { BRAVE_API_KEY: "abc-123" } }
  );
  assert.equal(result.ok, true);
  assert.equal(result.env.TOKEN, "abc-123");
  assert.equal(result.env.PLAIN, "literal");
  assert.deepEqual(result.missing, []);
});

test("resolveMcpEnv reports missing env refs without exposing any value", () => {
  const result = resolveMcpEnv(
    { TOKEN: "${env:BRAVE_API_KEY}" },
    { processEnv: {} }
  );
  assert.equal(result.ok, false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.env, "TOKEN"), false);
  assert.deepEqual(result.missing, [
    { envKey: "TOKEN", type: "env", name: "BRAVE_API_KEY" }
  ]);
});

test("resolveMcpEnv resolves ${secret_ref:REF} via secretStore.getSync, value stays internal on miss", () => {
  const calls = [];
  const secretStore = {
    getSync(ref) {
      calls.push(ref);
      return ref === "secret://lingxy/provider/openai/apiKey" ? "sk-real-value" : null;
    }
  };
  const ok = resolveMcpEnv(
    { OPENAI_API_KEY: "${secret_ref:secret://lingxy/provider/openai/apiKey}" },
    { secretStore }
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.env.OPENAI_API_KEY, "sk-real-value");
  assert.deepEqual(calls, ["secret://lingxy/provider/openai/apiKey"]);

  const missing = resolveMcpEnv(
    { OPENAI_API_KEY: "${secret_ref:secret://lingxy/provider/missing/apiKey}" },
    { secretStore }
  );
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing, [
    {
      envKey: "OPENAI_API_KEY",
      type: "secret_ref",
      name: "secret://lingxy/provider/missing/apiKey"
    }
  ]);
  // Crucially: the missing entry never carries the secret value — the structure
  // only describes the reference that needs to be supplied.
  assert.equal(Object.prototype.hasOwnProperty.call(missing.missing[0], "value"), false);
});

test("resolveMcpEnv accepts URL-encoded secret refs produced by the local secret store", () => {
  const secretStore = {
    getSync(ref) {
      return ref === "secret://lingxy/mcp/custom%20server/env/API_KEY" ? "encoded-value" : null;
    }
  };
  const resolved = resolveMcpEnv(
    { API_KEY: "${secret_ref:secret://lingxy/mcp/custom%20server/env/API_KEY}" },
    { secretStore }
  );
  assert.equal(resolved.ok, true);
  assert.equal(resolved.env.API_KEY, "encoded-value");
});

test("resolveMcpEnv handles partial env: literals + resolved + missing in one pass", () => {
  const result = resolveMcpEnv(
    {
      MODE: "fast",
      OK_TOKEN: "${env:PRESENT}",
      MISSING_TOKEN: "${env:ABSENT}",
      SECRET: "${secret_ref:secret://lingxy/x}"
    },
    {
      processEnv: { PRESENT: "yes" },
      secretStore: { getSync: () => null }
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.env.MODE, "fast");
  assert.equal(result.env.OK_TOKEN, "yes");
  assert.equal(Object.prototype.hasOwnProperty.call(result.env, "MISSING_TOKEN"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.env, "SECRET"), false);
  assert.deepEqual(result.missing.map((m) => m.envKey).sort(), ["MISSING_TOKEN", "SECRET"]);
});

test("resolveMcpEnv treats null/undefined/non-object env as empty", () => {
  for (const env of [null, undefined, "string", [], 42]) {
    assert.deepEqual(resolveMcpEnv(env), { ok: true, env: {}, missing: [] });
  }
});

test("resolveMcpEnv parser stays narrow: malformed placeholders are literals, not partial refs", () => {
  // No partial template substitution — the value as a whole must match the
  // single-placeholder pattern. Anything else is a literal so the spawn gets
  // exactly what the descriptor declared.
  const result = resolveMcpEnv(
    {
      A: "${env:NAME}/suffix",
      B: "prefix-${env:NAME}",
      C: "${unknown:NAME}",
      D: "${env:bad name}"
    },
    { processEnv: { NAME: "xyz" } }
  );
  assert.equal(result.ok, true);
  assert.equal(result.env.A, "${env:NAME}/suffix");
  assert.equal(result.env.B, "prefix-${env:NAME}");
  assert.equal(result.env.C, "${unknown:NAME}");
  assert.equal(result.env.D, "${env:bad name}");
});

test("describeMcpEnvRequirements lists references without resolving them", () => {
  const result = describeMcpEnvRequirements({
    LITERAL: "x",
    A: "${env:FOO}",
    B: "${secret_ref:secret://lingxy/y}"
  });
  assert.equal(result.hasReferences, true);
  assert.deepEqual(result.references.sort((a, b) => a.envKey.localeCompare(b.envKey)), [
    { envKey: "A", type: "env", name: "FOO" },
    { envKey: "B", type: "secret_ref", name: "secret://lingxy/y" }
  ]);
});

// ── createConfiguredMCPServer status ────────────────────────────────────────

test("createConfiguredMCPServer reports missing_config when env refs are unresolved", async () => {
  const server = createConfiguredMCPServer({
    id: "brave",
    displayName: "Brave Search",
    transport: "http",
    url: "https://brave.example/mcp",
    env: { BRAVE_API_KEY: "${env:BRAVE_API_KEY}" }
  });
  const status = await server.getStatus({ processEnv: {} });
  assert.equal(status.id, "brave");
  assert.equal(status.detail, "missing_config");
  assert.equal(status.available, false);
  assert.deepEqual(status.missingEnv, [
    { envKey: "BRAVE_API_KEY", type: "env", name: "BRAVE_API_KEY" }
  ]);
  assert.equal(status.envRequirements.length, 1);
});

test("createConfiguredMCPServer reports ready when env refs resolve and command exists", async () => {
  const server = createConfiguredMCPServer({
    id: "brave-ready",
    displayName: "Brave Search",
    transport: "http",
    url: "https://brave.example/mcp",
    env: { BRAVE_API_KEY: "${env:BRAVE_API_KEY}" }
  });
  const status = await server.getStatus({ processEnv: { BRAVE_API_KEY: "x" } });
  assert.equal(status.detail, "ready");
  assert.equal(status.available, true);
  assert.equal(Object.prototype.hasOwnProperty.call(status, "missingEnv"), false);
});

test("createConfiguredMCPServer.isAvailable short-circuits on missing config without touching commandExists", async () => {
  // The sentinel here is that we don't blow up — the configured server returns
  // false before resolving the (made-up) command path.
  const server = createConfiguredMCPServer({
    id: "needs-secret",
    transport: "stdio",
    command: "/path/that/should-never-exist/xyz",
    env: { OPENAI_API_KEY: "${secret_ref:secret://lingxy/missing}" }
  });
  const available = await server.isAvailable({
    secretStore: { getSync: () => null }
  });
  assert.equal(available, false);
});

test("MCP command existence lookup uses a short TTL cache", () => {
  clearMcpCommandExistsCacheForTests();
  let lookups = 0;
  const lookup = () => {
    lookups += 1;
    return { status: 0 };
  };

  assert.equal(commandExists("definitely-present-mcp", { now: 1000, lookup }), true);
  assert.equal(commandExists("definitely-present-mcp", { now: 1100, lookup }), true);
  assert.equal(lookups, 1);

  assert.equal(commandExists("definitely-present-mcp", {
    now: 1000 + 5 * 60 * 1000 + 1,
    lookup
  }), true);
  assert.equal(lookups, 2);
});

test("createConfiguredMCPServer secret_ref resolves through the supplied secretStore", async () => {
  const server = createConfiguredMCPServer({
    id: "needs-secret-ok",
    transport: "http",
    url: "https://x.example",
    env: { TOKEN: "${secret_ref:secret://lingxy/token}" }
  });
  const status = await server.getStatus({
    secretStore: {
      getSync(ref) {
        return ref === "secret://lingxy/token" ? "stored-value" : null;
      }
    }
  });
  assert.equal(status.detail, "ready");
  assert.equal(status.available, true);
});

test("runtime-patched builtin MCP env overrides use the same missing_config contract", async () => {
  const platform = buildAIIntegrationRegistries({
    config: {
      ai: {
        mcp: {
          builtinToggles: {
            "mcp-brave-search": { enabled: true }
          },
          envOverrides: {
            "mcp-brave-search": {
              BRAVE_API_KEY: "${env:BRAVE_API_KEY}"
            }
          }
        }
      }
    }
  });

  const server = platform.mcpServers.get("mcp-brave-search");
  const status = await server.getStatus({ processEnv: {} });

  assert.equal(status.detail, "missing_config");
  assert.equal(status.available, false);
  assert.deepEqual(status.missingEnv, [
    { envKey: "BRAVE_API_KEY", type: "env", name: "BRAVE_API_KEY" }
  ]);
});

// ── client-bridge no-spawn on missing refs ──────────────────────────────────

test("connectMcpServer does NOT spawn when env refs are missing and records a structured skip reason", async () => {
  await disconnectAll();
  const tools = await connectMcpServer({
    id: "ghost-mcp",
    command: "node",
    args: [],
    env: { TOKEN: "${env:GHOST_MCP_TOKEN}" }
  }, {
    processEnv: {} // GHOST_MCP_TOKEN intentionally absent
  });
  assert.deepEqual(tools, []);
  const reason = getMcpSkipReason("ghost-mcp");
  assert.ok(reason, "expected a structured skip reason after missing-env refusal");
  assert.equal(reason.reason, "missing_config");
  assert.deepEqual(reason.missing, [
    { envKey: "TOKEN", type: "env", name: "GHOST_MCP_TOKEN" }
  ]);
  await disconnectAll();
});

test("connectMcpServer skip reason is cleared once env resolves on a fresh attempt", async () => {
  await disconnectAll();
  // First attempt: refs missing — skip reason set.
  await connectMcpServer({
    id: "clear-reason-mcp",
    command: "node",
    args: ["-e", "process.exit(0)"],
    env: { TOKEN: "${env:CLEAR_REASON_MCP_TOKEN}" }
  }, { processEnv: {} });
  assert.ok(getMcpSkipReason("clear-reason-mcp"));

  // Second attempt: refs resolve. We pass refresh=true so the cache check
  // doesn't short-circuit. The connect itself may still fail because the
  // command isn't a real MCP server, but the skip-reason map must reflect
  // that we passed the env gate this time.
  await connectMcpServer({
    id: "clear-reason-mcp",
    command: "node",
    args: ["-e", "process.exit(0)"],
    env: { TOKEN: "${env:CLEAR_REASON_MCP_TOKEN}" }
  }, {
    processEnv: { CLEAR_REASON_MCP_TOKEN: "present" },
    refresh: true
  });
  assert.equal(getMcpSkipReason("clear-reason-mcp"), null);
  await disconnectAll();
});
