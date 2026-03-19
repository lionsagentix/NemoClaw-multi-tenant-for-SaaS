// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { execSync } = require("child_process");

const GLOBAL_CREDS_DIR = path.join(process.env.HOME || "/tmp", ".nemoclaw");

/**
 * Resolve credentials directory. If tenantId is provided, uses
 * ~/.nemoclaw/tenants/{tenantId}/credentials.json for tenant isolation.
 * Falls back to global ~/.nemoclaw/credentials.json for single-tenant mode.
 */
function resolveCredsPath(tenantId) {
  if (tenantId) {
    return {
      dir: path.join(process.env.HOME || "/tmp", ".nemoclaw", "tenants", tenantId),
      file: path.join(process.env.HOME || "/tmp", ".nemoclaw", "tenants", tenantId, "credentials.json"),
    };
  }
  return {
    dir: GLOBAL_CREDS_DIR,
    file: path.join(GLOBAL_CREDS_DIR, "credentials.json"),
  };
}

// Backward-compatible exports (point to global)
const CREDS_DIR = GLOBAL_CREDS_DIR;
const CREDS_FILE = path.join(GLOBAL_CREDS_DIR, "credentials.json");

function loadCredentials(tenantId) {
  const { file } = resolveCredsPath(tenantId);
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    }
  } catch {}
  return {};
}

function saveCredential(key, value, tenantId) {
  const { dir, file } = resolveCredsPath(tenantId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const creds = loadCredentials(tenantId);
  creds[key] = value;
  fs.writeFileSync(file, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

function getCredential(key, tenantId) {
  // When operating in tenant-scoped mode, ONLY read from the tenant's
  // credential file. Falling through to process.env would leak a global
  // env var (e.g., NVIDIA_API_KEY set in the operator's shell) into a
  // tenant-scoped request, breaking credential isolation.
  // Ported from OpenClaw fix da34f81ce2.
  if (tenantId) {
    const creds = loadCredentials(tenantId);
    return creds[key] || null;
  }
  // Global (single-tenant) mode: env var first, then global creds file
  if (process.env[key]) return process.env[key];
  const creds = loadCredentials();
  return creds[key] || null;
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      if (!process.stdin.isTTY) {
        if (typeof process.stdin.pause === "function") {
          process.stdin.pause();
        }
        if (typeof process.stdin.unref === "function") {
          process.stdin.unref();
        }
      }
      resolve(answer.trim());
    });
  });
}

async function ensureApiKey() {
  let key = getCredential("NVIDIA_API_KEY");
  if (key) {
    process.env.NVIDIA_API_KEY = key;
    return;
  }

  console.log("");
  console.log("  ┌─────────────────────────────────────────────────────────────────┐");
  console.log("  │  NVIDIA API Key required                                        │");
  console.log("  │                                                                 │");
  console.log("  │  1. Go to https://build.nvidia.com/settings/api-keys            │");
  console.log("  │  2. Sign in with your NVIDIA account                            │");
  console.log("  │  3. Click 'Generate API Key' button                             │");
  console.log("  │  4. Paste the key below (starts with nvapi-)                    │");
  console.log("  └─────────────────────────────────────────────────────────────────┘");
  console.log("");

  key = await prompt("  NVIDIA API Key: ");

  if (!key || !key.startsWith("nvapi-")) {
    console.error("  Invalid key. Must start with nvapi-");
    process.exit(1);
  }

  saveCredential("NVIDIA_API_KEY", key);
  process.env.NVIDIA_API_KEY = key;
  console.log("");
  console.log("  Key saved to ~/.nemoclaw/credentials.json (mode 600)");
  console.log("");
}

function isRepoPrivate(repo) {
  try {
    const json = execSync(`gh api repos/${repo} --jq .private 2>/dev/null`, { encoding: "utf-8" }).trim();
    return json === "true";
  } catch {
    return false;
  }
}

async function ensureGithubToken() {
  let token = getCredential("GITHUB_TOKEN");
  if (token) {
    process.env.GITHUB_TOKEN = token;
    return;
  }

  try {
    token = execSync("gh auth token 2>/dev/null", { encoding: "utf-8" }).trim();
    if (token) {
      process.env.GITHUB_TOKEN = token;
      return;
    }
  } catch {}

  console.log("");
  console.log("  ┌──────────────────────────────────────────────────┐");
  console.log("  │  GitHub token required (private repo detected)   │");
  console.log("  │                                                  │");
  console.log("  │  Option A: gh auth login (if you have gh CLI)    │");
  console.log("  │  Option B: Paste a PAT with read:packages scope  │");
  console.log("  └──────────────────────────────────────────────────┘");
  console.log("");

  token = await prompt("  GitHub Token: ");

  if (!token) {
    console.error("  Token required for deploy (repo is private).");
    process.exit(1);
  }

  saveCredential("GITHUB_TOKEN", token);
  process.env.GITHUB_TOKEN = token;
  console.log("");
  console.log("  Token saved to ~/.nemoclaw/credentials.json (mode 600)");
  console.log("");
}

module.exports = {
  CREDS_DIR,
  CREDS_FILE,
  loadCredentials,
  saveCredential,
  getCredential,
  prompt,
  ensureApiKey,
  ensureGithubToken,
  isRepoPrivate,
};
