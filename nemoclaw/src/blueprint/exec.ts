// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PluginLogger } from "../index.js";

// Env vars blocked from child processes to prevent injection attacks.
// Ported from OpenClaw security fixes 089a43f5e8 and f84a41dcb8.
const BLOCKED_ENV_VARS = new Set([
  "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
  "BASH_ENV", "ENV", "CDPATH", "IFS", "PS4",
  "GCONV_PATH", "GLIBC_TUNABLES",
  "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS",
  "MAVEN_OPTS", "SBT_OPTS", "GRADLE_OPTS", "ANT_OPTS", "GRADLE_USER_HOME",
  "PYTHONBREAKPOINT", "DOTNET_STARTUP_HOOKS", "DOTNET_ADDITIONAL_DEPS",
  "SSLKEYLOGFILE",
]);

function sanitizeEnv(extra: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = { ...process.env as Record<string, string>, ...extra };
  for (const key of Object.keys(base)) {
    if (BLOCKED_ENV_VARS.has(key) || key.startsWith("BASH_FUNC_")) {
      delete base[key];
    }
  }
  return base;
}

export type BlueprintAction = "plan" | "apply" | "status" | "rollback";

export interface BlueprintRunOptions {
  blueprintPath: string;
  action: BlueprintAction;
  profile: string;
  planPath?: string;
  runId?: string;
  jsonOutput?: boolean;
  dryRun?: boolean;
  endpointUrl?: string;
}

export interface BlueprintRunResult {
  success: boolean;
  runId: string;
  action: BlueprintAction;
  output: string;
  exitCode: number;
}

function failResult(action: BlueprintAction, message: string): BlueprintRunResult {
  return { success: false, runId: "error", action, output: message, exitCode: 1 };
}

export async function execBlueprint(
  options: BlueprintRunOptions,
  logger: PluginLogger,
): Promise<BlueprintRunResult> {
  const runnerPath = join(options.blueprintPath, "orchestrator", "runner.py");

  if (!existsSync(runnerPath)) {
    const msg = `Blueprint runner not found at ${runnerPath}. Is the blueprint installed correctly?`;
    logger.error(msg);
    return failResult(options.action, msg);
  }

  // Verify the blueprint directory contains expected marker files before
  // executing. A malicious blueprint could contain a runner.py that
  // exfiltrates credentials. Ported from OpenClaw stabilization fix a2a9a553e1.
  const requiredMarkers = ["blueprint.yaml", "orchestrator/runner.py"];
  for (const marker of requiredMarkers) {
    if (!existsSync(join(options.blueprintPath, marker))) {
      const msg = `Blueprint missing required file: ${marker}. The blueprint may be corrupt or tampered with.`;
      logger.error(msg);
      return failResult(options.action, msg);
    }
  }

  const args: string[] = [runnerPath, options.action, "--profile", options.profile];

  if (options.jsonOutput) args.push("--json");
  if (options.planPath) args.push("--plan", options.planPath);
  if (options.runId) args.push("--run-id", options.runId);
  if (options.dryRun) args.push("--dry-run");
  if (options.endpointUrl) args.push("--endpoint-url", options.endpointUrl);

  logger.info(`Running blueprint: ${options.action} (profile: ${options.profile})`);

  return new Promise((resolve) => {
    const chunks: string[] = [];
    const proc = spawn("python3", args, {
      cwd: options.blueprintPath,
      env: sanitizeEnv({
        NEMOCLAW_BLUEPRINT_PATH: options.blueprintPath,
        NEMOCLAW_ACTION: options.action,
      }),
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.stdout.on("data", (data: Buffer) => {
      const line = data.toString();
      chunks.push(line);
    });

    proc.stderr.on("data", (data: Buffer) => {
      const line = data.toString().trim();
      if (line) logger.warn(line);
    });

    proc.on("close", (code) => {
      const output = chunks.join("");
      const runIdMatch = output.match(/^RUN_ID:(.+)$/m);
      resolve({
        success: code === 0,
        runId: runIdMatch?.[1] ?? "unknown",
        action: options.action,
        output,
        exitCode: code ?? 1,
      });
    });

    proc.on("error", (err) => {
      const msg = err.message.includes("ENOENT")
        ? "python3 not found. The blueprint runner requires Python 3.11+."
        : `Failed to start blueprint runner: ${err.message}`;
      logger.error(msg);
      resolve(failResult(options.action, msg));
    });
  });
}
