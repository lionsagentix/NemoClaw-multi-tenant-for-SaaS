// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

const { execSync, spawnSync } = require("child_process");
const path = require("path");
const { detectDockerHost } = require("./platform");

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPTS = path.join(ROOT, "scripts");

const dockerHost = detectDockerHost();
if (dockerHost) {
  process.env.DOCKER_HOST = dockerHost.dockerHost;
}

// ── Env injection blocklist ──────────────────────────────────────
// Prevent child processes from inheriting dangerous environment variables
// that could be used for code injection via build tools, linkers, or runtimes.
// Ported from OpenClaw security fixes 089a43f5e8 and f84a41dcb8.
const BLOCKED_ENV_VARS = new Set([
  // Linker injection
  "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
  // Shell injection
  "BASH_ENV", "ENV", "CDPATH", "IFS", "PS4",
  // glibc
  "GCONV_PATH", "GLIBC_TUNABLES",
  // JVM injection
  "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS",
  // Build tool JVM args
  "MAVEN_OPTS", "SBT_OPTS", "GRADLE_OPTS", "ANT_OPTS", "GRADLE_USER_HOME",
  // Python / .NET injection
  "PYTHONBREAKPOINT", "DOTNET_STARTUP_HOOKS", "DOTNET_ADDITIONAL_DEPS",
  // TLS key logging
  "SSLKEYLOGFILE",
]);

function sanitizeEnv(extraEnv) {
  const base = { ...process.env, ...extraEnv };
  for (const key of Object.keys(base)) {
    if (BLOCKED_ENV_VARS.has(key) || key.startsWith("BASH_FUNC_")) {
      delete base[key];
    }
  }
  return base;
}

function run(cmd, opts = {}) {
  const stdio = opts.stdio ?? ["ignore", "inherit", "inherit"];
  const result = spawnSync("bash", ["-c", cmd], {
    stdio,
    cwd: ROOT,
    env: sanitizeEnv(opts.env),
    ...opts,
  });
  if (result.status !== 0 && !opts.ignoreError) {
    console.error(`  Command failed (exit ${result.status}): ${cmd.slice(0, 80)}`);
    process.exit(result.status || 1);
  }
  return result;
}

function runInteractive(cmd, opts = {}) {
  const stdio = opts.stdio ?? "inherit";
  const result = spawnSync("bash", ["-c", cmd], {
    stdio,
    cwd: ROOT,
    env: sanitizeEnv(opts.env),
    ...opts,
  });
  if (result.status !== 0 && !opts.ignoreError) {
    console.error(`  Command failed (exit ${result.status}): ${cmd.slice(0, 80)}`);
    process.exit(result.status || 1);
  }
  return result;
}

function runCapture(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      cwd: ROOT,
      env: sanitizeEnv(opts.env),
      stdio: ["pipe", "pipe", "pipe"],
      ...opts,
    }).trim();
  } catch (err) {
    if (opts.ignoreError) return "";
    throw err;
  }
}

module.exports = { ROOT, SCRIPTS, run, runCapture, runInteractive };
