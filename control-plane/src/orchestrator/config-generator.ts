// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Per-tenant NemoClaw configuration generator.
//
// Generates NemoClawOnboardConfig for each tenant's sandbox based on their
// credential mode and inference provider settings.

import type { Tenant, TenantCredentialMode } from "../tenants/types.js";

/** Inference provider configuration for a tenant sandbox. */
export type TenantInferenceConfig = {
  endpointType: "build" | "ncp" | "nim-local" | "vllm" | "ollama" | "custom";
  endpointUrl: string;
  model: string;
  profile: string;
  credentialEnv: string;
  provider: string;
  providerLabel: string;
};

/** Platform-provided AI keys. */
export type PlatformKeys = {
  nvidiaKey?: string;
  openaiKey?: string;
};

/** Generated sandbox configuration. */
export type TenantSandboxConfig = {
  /** NemoClaw onboard config for the sandbox. */
  onboardConfig: TenantInferenceConfig;
  /** Environment variables to inject into the sandbox. */
  env: Record<string, string>;
  /** Sandbox policy presets to apply. */
  policyPresets: string[];
};

/**
 * Generate per-tenant sandbox configuration based on credential mode.
 *
 * Credential modes:
 * - "platform": use platform operator's keys (metered + billed to tenant)
 * - "byok": tenant provides their own keys (no platform metering)
 * - "hybrid": tenant keys preferred, platform keys as fallback
 */
export function generateTenantConfig(params: {
  tenant: Tenant;
  credentialMode: TenantCredentialMode;
  platformKeys?: PlatformKeys;
  tenantApiKey?: string;
  inferenceOverrides?: Partial<TenantInferenceConfig>;
}): TenantSandboxConfig {
  const { tenant, credentialMode, platformKeys, tenantApiKey, inferenceOverrides } = params;

  const env: Record<string, string> = {
    NODE_ENV: "production",
    NEMOCLAW_TENANT_ID: tenant.id,
    NEMOCLAW_TENANT_SLUG: tenant.slug,
  };

  // Build inference config based on credential mode.
  let onboardConfig: TenantInferenceConfig;

  switch (credentialMode) {
    case "platform": {
      // Platform provides the keys — tenant is billed via usage metering.
      if (platformKeys?.nvidiaKey) {
        env.NVIDIA_API_KEY = platformKeys.nvidiaKey;
      }
      onboardConfig = {
        endpointType: "build",
        endpointUrl: "https://integrate.api.nvidia.com/v1",
        model: inferenceOverrides?.model ?? "nvidia/nemotron-3-super-120b-a12b",
        profile: "default",
        credentialEnv: "NVIDIA_API_KEY",
        provider: "nvidia",
        providerLabel: "NVIDIA Cloud API (Platform)",
      };
      break;
    }

    case "byok": {
      // Tenant brings their own key — not metered by platform.
      if (tenantApiKey) {
        env.NVIDIA_API_KEY = tenantApiKey;
      }
      onboardConfig = {
        endpointType: inferenceOverrides?.endpointType ?? "build",
        endpointUrl: inferenceOverrides?.endpointUrl ?? "https://integrate.api.nvidia.com/v1",
        model: inferenceOverrides?.model ?? "nvidia/nemotron-3-super-120b-a12b",
        profile: inferenceOverrides?.profile ?? "default",
        credentialEnv: inferenceOverrides?.credentialEnv ?? "NVIDIA_API_KEY",
        provider: inferenceOverrides?.provider ?? "nvidia",
        providerLabel: inferenceOverrides?.providerLabel ?? "NVIDIA Cloud API (BYOK)",
      };
      break;
    }

    case "hybrid": {
      // Tenant keys preferred, platform keys as fallback.
      if (tenantApiKey) {
        env.NVIDIA_API_KEY = tenantApiKey;
      } else if (platformKeys?.nvidiaKey) {
        env.NVIDIA_API_KEY = platformKeys.nvidiaKey;
      }
      onboardConfig = {
        endpointType: inferenceOverrides?.endpointType ?? "build",
        endpointUrl: inferenceOverrides?.endpointUrl ?? "https://integrate.api.nvidia.com/v1",
        model: inferenceOverrides?.model ?? "nvidia/nemotron-3-super-120b-a12b",
        profile: inferenceOverrides?.profile ?? "default",
        credentialEnv: inferenceOverrides?.credentialEnv ?? "NVIDIA_API_KEY",
        provider: inferenceOverrides?.provider ?? "nvidia",
        providerLabel: inferenceOverrides?.providerLabel ?? "NVIDIA Cloud API (Hybrid)",
      };
      break;
    }
  }

  // Apply any inference overrides.
  if (inferenceOverrides) {
    Object.assign(onboardConfig, inferenceOverrides);
  }

  // Default policy presets — can be customized per tenant via metadata.
  const policyPresets: string[] = [];
  if (tenant.metadata?.policyPresets) {
    policyPresets.push(...tenant.metadata.policyPresets.split(",").map((p) => p.trim()));
  }

  return {
    onboardConfig,
    env,
    policyPresets,
  };
}

/**
 * Validate a generated tenant sandbox config for security issues.
 *
 * Returns an array of violation descriptions. Empty array means safe.
 */
export function validateTenantSandboxSecurity(config: TenantSandboxConfig): string[] {
  const violations: string[] = [];

  // Ensure tenant ID and slug are present in env.
  if (!config.env.NEMOCLAW_TENANT_ID) {
    violations.push("Missing NEMOCLAW_TENANT_ID in sandbox environment.");
  }
  if (!config.env.NEMOCLAW_TENANT_SLUG) {
    violations.push("Missing NEMOCLAW_TENANT_SLUG in sandbox environment.");
  }

  // Ensure inference endpoint uses HTTPS in production.
  if (
    config.env.NODE_ENV === "production" &&
    config.onboardConfig.endpointUrl &&
    !config.onboardConfig.endpointUrl.startsWith("https://") &&
    !config.onboardConfig.endpointUrl.startsWith("http://localhost") &&
    !config.onboardConfig.endpointUrl.startsWith("http://127.0.0.1") &&
    !config.onboardConfig.endpointUrl.startsWith("http://inference.local")
  ) {
    violations.push(
      `Inference endpoint uses insecure HTTP in production: ${config.onboardConfig.endpointUrl}`,
    );
  }

  // Ensure credential env is set if not BYOK with own key.
  if (!config.onboardConfig.credentialEnv) {
    violations.push("No credential environment variable specified for inference.");
  }

  // Ensure no sensitive keys leak into policy presets or metadata.
  for (const [key, value] of Object.entries(config.env)) {
    if (key.includes("SECRET") || key.includes("PASSWORD")) {
      if (value && value.length < 8) {
        violations.push(`Suspicious short value for sensitive env var: ${key}`);
      }
    }
  }

  return violations;
}
