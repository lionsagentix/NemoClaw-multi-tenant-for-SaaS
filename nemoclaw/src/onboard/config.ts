// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const GLOBAL_CONFIG_DIR = join(process.env.HOME ?? "/tmp", ".nemoclaw");

/**
 * Resolve config directory. If tenantId is provided, uses per-tenant config.
 * Falls back to global config for single-tenant mode.
 */
function resolveConfigDir(tenantId?: string): string {
  if (tenantId) {
    return join(process.env.HOME ?? "/tmp", ".nemoclaw", "tenants", tenantId);
  }
  return GLOBAL_CONFIG_DIR;
}

export type EndpointType = "build" | "ncp" | "nim-local" | "vllm" | "ollama" | "custom";

export interface NemoClawOnboardConfig {
  endpointType: EndpointType;
  endpointUrl: string;
  ncpPartner: string | null;
  model: string;
  profile: string;
  credentialEnv: string;
  provider?: string;
  providerLabel?: string;
  onboardedAt: string;
}

export function describeOnboardEndpoint(config: NemoClawOnboardConfig): string {
  if (config.endpointUrl === "https://inference.local/v1") {
    return "Managed Inference Route (inference.local)";
  }

  return `${config.endpointType} (${config.endpointUrl})`;
}

export function describeOnboardProvider(config: NemoClawOnboardConfig): string {
  if (config.providerLabel) {
    return config.providerLabel;
  }

  switch (config.endpointType) {
    case "build":
      return "NVIDIA Cloud API";
    case "ollama":
      return "Local Ollama";
    case "vllm":
      return "Local vLLM";
    case "nim-local":
      return "Local NIM";
    case "ncp":
      return "NVIDIA Cloud Partner";
    case "custom":
      return "Managed Inference Route";
    default:
      return "Unknown";
  }
}

const createdConfigDirs = new Set<string>();

function ensureConfigDir(tenantId?: string): void {
  const dir = resolveConfigDir(tenantId);
  if (createdConfigDirs.has(dir)) return;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  createdConfigDirs.add(dir);
}

function configPath(tenantId?: string): string {
  return join(resolveConfigDir(tenantId), "config.json");
}

export function loadOnboardConfig(tenantId?: string): NemoClawOnboardConfig | null {
  ensureConfigDir(tenantId);
  const path = configPath(tenantId);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf-8")) as NemoClawOnboardConfig;
}

export function saveOnboardConfig(config: NemoClawOnboardConfig, tenantId?: string): void {
  ensureConfigDir(tenantId);
  writeFileSync(configPath(tenantId), JSON.stringify(config, null, 2));
}

export function clearOnboardConfig(tenantId?: string): void {
  const path = configPath(tenantId);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}
