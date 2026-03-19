// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// OpenShell sandbox runtime — wraps the `openshell` CLI to manage
// per-tenant sandboxes. Replaces the Docker/Kubernetes runtimes from OpenClaw.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Status of an OpenShell sandbox. */
export type SandboxStatus = {
  running: boolean;
  ready: boolean;
  state: "running" | "stopped" | "failed" | "unknown";
  message?: string;
};

/** Information returned after creating a sandbox. */
export type SandboxInfo = {
  sandboxName: string;
  host: string;
  port: number;
};

/** Parameters for creating a tenant sandbox. */
export type CreateSandboxParams = {
  tenantSlug: string;
  sandboxName: string;
  image: string;
  forwardPort: number;
  env?: Record<string, string>;
};

/** OpenShell runtime configuration. */
export type OpenShellRuntimeConfig = {
  /** Path to the openshell binary (default: "openshell"). */
  openshellBin?: string;
  /** Default sandbox image. */
  defaultImage?: string;
  /** Default forwarded port. */
  defaultPort?: number;
};

/** Separator between tenant slug and sandbox name. */
const TENANT_SEPARATOR = "--";

/**
 * Build the full sandbox name for a tenant.
 * Format: {tenantSlug}--{sandboxName}
 */
export function buildSandboxName(tenantSlug: string, sandboxName: string): string {
  return `${tenantSlug}${TENANT_SEPARATOR}${sandboxName}`;
}

/**
 * Parse a tenant sandbox name back into tenant slug and sandbox name.
 */
export function parseSandboxName(fullName: string): { tenantSlug: string; sandboxName: string } | null {
  const idx = fullName.indexOf(TENANT_SEPARATOR);
  if (idx === -1) return null;
  return {
    tenantSlug: fullName.slice(0, idx),
    sandboxName: fullName.slice(idx + TENANT_SEPARATOR.length),
  };
}

/**
 * Create an OpenShell sandbox runtime.
 */
export function createOpenShellRuntime(config: OpenShellRuntimeConfig = {}) {
  const {
    openshellBin = "openshell",
    defaultImage = "ghcr.io/nvidia/openshell-community/sandboxes/openclaw:latest",
    defaultPort = 18789,
  } = config;

  /** Execute an openshell CLI command. */
  async function exec(args: string[], timeoutMs = 60_000): Promise<{ stdout: string; stderr: string }> {
    try {
      const result = await execFileAsync(openshellBin, args, {
        timeout: timeoutMs,
        encoding: "utf-8",
      });
      return { stdout: result.stdout || "", stderr: result.stderr || "" };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; message?: string };
      // If the command failed, include stderr in the error.
      const stderr = execErr.stderr || "";
      const message = execErr.message || "Unknown error";
      throw new Error(`openshell ${args.join(" ")} failed: ${message}\n${stderr}`);
    }
  }

  /** Create a new sandbox for a tenant. */
  async function createSandbox(params: CreateSandboxParams): Promise<SandboxInfo> {
    const fullName = buildSandboxName(params.tenantSlug, params.sandboxName);
    const image = params.image || defaultImage;
    const port = params.forwardPort || defaultPort;

    const args = [
      "sandbox", "create",
      "--from", image,
      "--name", fullName,
      "--forward", String(port),
    ];

    try {
      await exec(args, 120_000); // Sandbox creation can take a while
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // If sandbox already exists, reuse it.
      if (errMsg.includes("already exists")) {
        console.warn(`[openshell-runtime] Sandbox ${fullName} already exists, reusing.`);
      } else {
        throw err;
      }
    }

    // Start port forwarding in background.
    try {
      await exec(["forward", "start", "--background", String(port), fullName]);
    } catch {
      // Port forwarding may already be active.
    }

    return {
      sandboxName: fullName,
      host: "localhost",
      port,
    };
  }

  /** Stop a sandbox. */
  async function stopSandbox(sandboxName: string): Promise<void> {
    await exec(["sandbox", "stop", sandboxName]);
  }

  /** Start a stopped sandbox. */
  async function startSandbox(sandboxName: string): Promise<void> {
    await exec(["sandbox", "start", sandboxName]);
  }

  /** Remove a sandbox completely. */
  async function removeSandbox(sandboxName: string): Promise<void> {
    try {
      await exec(["sandbox", "stop", sandboxName]);
    } catch {
      // May already be stopped.
    }
    await exec(["sandbox", "remove", sandboxName]);
  }

  /** Restart a sandbox. */
  async function restartSandbox(sandboxName: string): Promise<void> {
    await stopSandbox(sandboxName);
    await startSandbox(sandboxName);
  }

  /** Get sandbox status. */
  async function getSandboxStatus(sandboxName: string): Promise<SandboxStatus> {
    try {
      const { stdout } = await exec(["sandbox", "get", sandboxName]);
      const lower = stdout.toLowerCase();

      if (lower.includes("running")) {
        return { running: true, ready: true, state: "running" };
      } else if (lower.includes("stopped") || lower.includes("exited")) {
        return { running: false, ready: false, state: "stopped" };
      } else if (lower.includes("error") || lower.includes("failed")) {
        return { running: false, ready: false, state: "failed", message: stdout.trim() };
      }

      return { running: false, ready: false, state: "unknown", message: stdout.trim() };
    } catch {
      return { running: false, ready: false, state: "unknown" };
    }
  }

  /** Get sandbox logs. */
  async function getSandboxLogs(sandboxName: string, tail = 100): Promise<string> {
    try {
      const { stdout } = await exec(["sandbox", "logs", sandboxName, "--lines", String(tail)]);
      return stdout;
    } catch {
      return "(unable to fetch sandbox logs)";
    }
  }

  /** Apply a network policy to a sandbox. */
  async function applyPolicy(sandboxName: string, policyFilePath: string): Promise<void> {
    await exec(["policy", "set", "--policy", policyFilePath, "--wait", sandboxName]);
  }

  /** Configure inference provider for a sandbox. */
  async function configureInference(
    sandboxName: string,
    provider: { name: string; type: string; credentialEnv: string; config?: Record<string, string> },
    model: string,
  ): Promise<void> {
    const providerArgs = [
      "provider", "create",
      "--name", provider.name,
      "--type", provider.type,
      "--credential", provider.credentialEnv,
    ];
    if (provider.config) {
      for (const [key, value] of Object.entries(provider.config)) {
        providerArgs.push("--config", `${key}=${value}`);
      }
    }
    await exec(providerArgs);

    await exec(["inference", "set", "--provider", provider.name, "--model", model]);
  }

  /** List all sandboxes, optionally filtered by tenant prefix. */
  async function listSandboxes(tenantSlug?: string): Promise<string[]> {
    try {
      const { stdout } = await exec(["sandbox", "list"]);
      const names = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      if (tenantSlug) {
        const prefix = `${tenantSlug}${TENANT_SEPARATOR}`;
        return names.filter((name) => name.startsWith(prefix));
      }
      return names;
    } catch {
      return [];
    }
  }

  return {
    createSandbox,
    stopSandbox,
    startSandbox,
    removeSandbox,
    restartSandbox,
    getSandboxStatus,
    getSandboxLogs,
    applyPolicy,
    configureInference,
    listSandboxes,
    buildSandboxName,
    parseSandboxName,
  };
}

export type OpenShellRuntime = ReturnType<typeof createOpenShellRuntime>;
