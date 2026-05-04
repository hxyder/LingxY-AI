import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMcpConfigFields,
  describeMcpMissingConfig,
  formatMissingNamesSummary,
  isMcpMissingConfig,
  listMcpMissingConfigFields,
  listMcpMissingNames
} from "../../src/desktop/renderer/mcp-missing-config.mjs";

test("isMcpMissingConfig returns true when backend reports detail: missing_config", () => {
  assert.equal(isMcpMissingConfig({ detail: "missing_config" }), true);
});

test("isMcpMissingConfig returns true when missingEnv is non-empty", () => {
  assert.equal(
    isMcpMissingConfig({
      missingEnv: [{ envKey: "TOKEN", type: "env", name: "BRAVE_API_KEY" }]
    }),
    true
  );
});

test("isMcpMissingConfig returns false for healthy / null / unrelated detail values", () => {
  assert.equal(isMcpMissingConfig({ detail: "ready", available: true }), false);
  assert.equal(isMcpMissingConfig({ detail: "disabled" }), false);
  assert.equal(isMcpMissingConfig({ detail: "package_not_found" }), false);
  assert.equal(isMcpMissingConfig({ missingEnv: [] }), false);
  assert.equal(isMcpMissingConfig(null), false);
  assert.equal(isMcpMissingConfig(undefined), false);
});

test("listMcpMissingNames extracts unique names without exposing values", () => {
  const names = listMcpMissingNames({
    missingEnv: [
      { envKey: "TOKEN", type: "env", name: "BRAVE_API_KEY" },
      { envKey: "DUPLICATE", type: "env", name: "BRAVE_API_KEY" },
      { envKey: "OPENAI", type: "secret_ref", name: "secret://lingxy/openai" }
    ]
  });
  assert.deepEqual(names, ["BRAVE_API_KEY", "secret://lingxy/openai"]);
});

test("listMcpMissingNames falls back to envKey when name is absent", () => {
  const names = listMcpMissingNames({
    missingEnv: [{ envKey: "X_KEY", type: "env" }]
  });
  assert.deepEqual(names, ["X_KEY"]);
});

test("listMcpMissingNames returns [] for non-array / missing missingEnv", () => {
  assert.deepEqual(listMcpMissingNames({}), []);
  assert.deepEqual(listMcpMissingNames({ missingEnv: null }), []);
  assert.deepEqual(listMcpMissingNames(null), []);
});

test("formatMissingNamesSummary joins up to three names and abbreviates the rest", () => {
  assert.equal(formatMissingNamesSummary([]), "");
  assert.equal(formatMissingNamesSummary(["A"]), "A");
  assert.equal(formatMissingNamesSummary(["A", "B", "C"]), "A, B, C");
  assert.equal(formatMissingNamesSummary(["A", "B", "C", "D"]), "A, B, C +1");
  assert.equal(formatMissingNamesSummary(["A", "B", "C", "D", "E"]), "A, B, C +2");
});

test("describeMcpMissingConfig returns missing/names/summary together", () => {
  const result = describeMcpMissingConfig({
    detail: "missing_config",
    missingEnv: [
      { envKey: "TOKEN", type: "env", name: "BRAVE_API_KEY" }
    ]
  });
  assert.equal(result.missing, true);
  assert.deepEqual(result.names, ["BRAVE_API_KEY"]);
  assert.equal(result.summary, "BRAVE_API_KEY");
});

test("describeMcpMissingConfig handles missing_config with no missingEnv array", () => {
  const result = describeMcpMissingConfig({ detail: "missing_config" });
  assert.equal(result.missing, true);
  assert.deepEqual(result.names, []);
  assert.equal(result.summary, "");
});

test("describeMcpMissingConfig is a no-op for ready servers", () => {
  const result = describeMcpMissingConfig({ detail: "ready", available: true });
  assert.equal(result.missing, false);
  assert.deepEqual(result.names, []);
  assert.equal(result.summary, "");
});

// Defence in depth: even if a caller wrongly attaches a `value`, the helper
// must not echo it. We only ever read `name` and `envKey`.
test("listMcpMissingNames never reads .value off entries", () => {
  const out = listMcpMissingNames({
    missingEnv: [
      { envKey: "TOKEN", name: "BRAVE_API_KEY", value: "leaked-secret" }
    ]
  });
  assert.deepEqual(out, ["BRAVE_API_KEY"]);
});

test("listMcpMissingConfigFields normalizes dynamic form fields by envKey", () => {
  const fields = listMcpMissingConfigFields({
    missingEnv: [
      { envKey: "TOKEN", type: "env", name: "SERVICE_TOKEN" },
      { envKey: "TOKEN", type: "env", name: "DUPLICATE_SHOULD_NOT_WIN" },
      { envKey: "ACCOUNT", type: "secret_ref", name: "secret://lingxy/custom/account" }
    ]
  });
  assert.deepEqual(fields, [
    { envKey: "TOKEN", type: "env", name: "SERVICE_TOKEN", label: "SERVICE_TOKEN" },
    { envKey: "ACCOUNT", type: "secret_ref", name: "secret://lingxy/custom/account", label: "secret://lingxy/custom/account" }
  ]);
});

test("listMcpMissingConfigFields never copies submitted values into field schema", () => {
  const fields = listMcpMissingConfigFields({
    missingEnv: [
      { envKey: "TOKEN", type: "env", name: "SERVICE_TOKEN", value: "do-not-show" }
    ]
  });
  assert.equal(Object.prototype.hasOwnProperty.call(fields[0], "value"), false);
  assert.doesNotMatch(JSON.stringify(fields), /do-not-show/);
});

test("buildMcpConfigFields prefers backend missingEnv and falls back to known configKey", () => {
  assert.deepEqual(
    buildMcpConfigFields({ detail: "disabled" }, {
      configKey: "BRAVE_API_KEY",
      configLabel: "Brave API Key",
      configPlaceholder: "BSA..."
    }),
    [{
      envKey: "BRAVE_API_KEY",
      type: "env",
      name: "BRAVE_API_KEY",
      label: "Brave API Key",
      placeholder: "BSA..."
    }]
  );
  assert.deepEqual(
    buildMcpConfigFields({
      missingEnv: [{ envKey: "TOKEN", type: "env", name: "SERVICE_TOKEN" }]
    }, {
      configKey: "BRAVE_API_KEY",
      configLabel: "Brave API Key"
    }),
    [{
      envKey: "TOKEN",
      type: "env",
      name: "SERVICE_TOKEN",
      label: "SERVICE_TOKEN",
      placeholder: ""
    }]
  );
});
