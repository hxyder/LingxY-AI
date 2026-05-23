#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  RELEASE_OAUTH_CLIENTS_RESOURCE,
  normalizeConnectorOAuthDefaults
} from "../src/service/capabilities/connectors/oauth-defaults.mjs";

const outputPath = path.resolve(".tmp", "release", RELEASE_OAUTH_CLIENTS_RESOURCE);

const SECRET_ENV_KEYS = Object.freeze([
  "LINGXY_RELEASE_GOOGLE_OAUTH_CLIENT_SECRET",
  "LINGXY_GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "LINGXY_RELEASE_MICROSOFT_OAUTH_CLIENT_SECRET",
  "LINGXY_MICROSOFT_OAUTH_CLIENT_SECRET",
  "MICROSOFT_OAUTH_CLIENT_SECRET"
]);

const CLIENT_ID_ENV_KEYS = Object.freeze({
  google: Object.freeze([
    "LINGXY_RELEASE_GOOGLE_OAUTH_CLIENT_ID",
    "LINGXY_GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_ID"
  ]),
  microsoft: Object.freeze([
    "LINGXY_RELEASE_MICROSOFT_OAUTH_CLIENT_ID",
    "LINGXY_MICROSOFT_OAUTH_CLIENT_ID",
    "MICROSOFT_OAUTH_CLIENT_ID"
  ])
});

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstEnv(keys) {
  for (const key of keys) {
    const value = clean(process.env[key]);
    if (value) return value;
  }
  return "";
}

for (const key of SECRET_ENV_KEYS) {
  if (clean(process.env[key])) {
    console.error(`[release-oauth] ${key} must not be bundled into a desktop installer. Use a public OAuth client id with PKCE.`);
    process.exit(1);
  }
}

const payload = normalizeConnectorOAuthDefaults({
  connectors: {
    google: { clientId: firstEnv(CLIENT_ID_ENV_KEYS.google) },
    microsoft: { clientId: firstEnv(CLIENT_ID_ENV_KEYS.microsoft) }
  }
});

const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  connectors: payload.connectors
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  output: path.relative(process.cwd(), outputPath),
  providers: Object.keys(output.connectors)
}, null, 2));
