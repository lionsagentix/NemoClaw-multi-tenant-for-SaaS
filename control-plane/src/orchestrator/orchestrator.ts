// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Sandbox orchestrator — manages the full lifecycle of tenant OpenShell sandboxes.
//
// Coordinates between the tenant store (database) and the OpenShell runtime
// to provision, deprovision, and manage tenant sandboxes.

import crypto from "node:crypto";
import {
  createTenant,
  updateTenantStatus,
  updateTenantSandbox,
  deleteTenant,
  createApiKey,
  writeAuditLog,
  getTenant,
} from "../tenants/tenant-store.js";
import type { Tenant, TenantProvisionResult, CreateTenantParams, TenantPlan } from "../tenants/types.js";
import { DEFAULT_PLAN_QUOTAS } from "../tenants/types.js";
import { DEFAULT_RESOURCE_TIERS, type ResourceTier } from "../tenants/resource-tiers.js";
import { generateTenantConfig, type PlatformKeys } from "./config-generator.js";
import type { OpenShellRuntime } from "./openshell-runtime.js";

const DEFAULT_SANDBOX_NAME = "openclaw";
const HEALTHCHECK_POLL_INTERVAL_MS = 2_000;
const HEALTHCHECK_MAX_WAIT_MS = 120_000;

export type OrchestratorConfig = {
  /** OpenShell runtime for sandbox management. */
  runtime: OpenShellRuntime;
  /** Default sandbox image. */
  sandboxImage?: string;
  /** Default sandbox port. */
  sandboxPort?: number;
  /** Resource tiers per plan (optional override). */
  resourceTiers?: Record<TenantPlan, ResourceTier>;
  /** Platform AI keys to inject for platform/hybrid credential modes. */
  platformKeys?: PlatformKeys;
  /** Port range for tenant sandbox port allocation. */
  portRange?: { start: number; end: number };
};

/**
 * Create a sandbox orchestrator.
 *
 * The orchestrator is the central coordination point for tenant sandbox lifecycle:
 * provision, deprovision, start, stop, restart.
 */
export function createOrchestrator(config: OrchestratorConfig) {
  const {
    runtime,
    sandboxImage = "ghcr.io/nvidia/openshell-community/sandboxes/openclaw:latest",
    sandboxPort = 18789,
    resourceTiers = DEFAULT_RESOURCE_TIERS,
    platformKeys,
    portRange = { start: 19000, end: 29000 },
  } = config;

  /** Allocate a port from the configured range for a tenant. */
  let nextPort = portRange.start;
  function allocatePort(): number {
    const port = nextPort;
    nextPort++;
    if (nextPort > portRange.end) {
      nextPort = portRange.start;
    }
    return port;
  }

  /**
   * Provision a new tenant: create DB record, create sandbox, configure inference.
   *
   * Full provisioning flow:
   * 1. Validate and create tenant record (status: provisioning)
   * 2. Generate sandbox auth token
   * 3. Generate tenant config (inference + env)
   * 4. Create OpenShell sandbox
   * 5. Configure inference in sandbox
   * 6. Wait for sandbox to be ready
   * 7. Update tenant record with sandbox info (status: active)
   * 8. Generate tenant API key
   * 9. Write audit log
   */
  async function provisionTenant(
    params: CreateTenantParams,
    actor: string,
  ): Promise<TenantProvisionResult> {
    // 1. Create tenant record in database.
    const tenant = await createTenant(params, DEFAULT_PLAN_QUOTAS);

    try {
      // 2. Generate sandbox auth token.
      const sandboxToken = `sb_${crypto.randomBytes(32).toString("hex")}`;

      // 3. Generate tenant config.
      const tenantConfig = generateTenantConfig({
        tenant,
        credentialMode: tenant.credentialMode,
        platformKeys,
      });

      // 4. Create OpenShell sandbox.
      const allocatedPort = allocatePort();
      const sandboxInfo = await runtime.createSandbox({
        tenantSlug: tenant.slug,
        sandboxName: DEFAULT_SANDBOX_NAME,
        image: sandboxImage,
        forwardPort: allocatedPort,
        env: { ...tenantConfig.env, NEMOCLAW_SANDBOX_TOKEN: sandboxToken },
      });

      // 5. Configure inference in sandbox.
      await runtime.configureInference(
        sandboxInfo.sandboxName,
        {
          name: tenantConfig.onboardConfig.provider,
          type: tenantConfig.onboardConfig.endpointType === "build" ? "nvidia" : "openai",
          credentialEnv: tenantConfig.onboardConfig.credentialEnv,
          config: { endpoint_url: tenantConfig.onboardConfig.endpointUrl },
        },
        tenantConfig.onboardConfig.model,
      );

      // 6. Apply network policies if configured.
      // Policy application is deferred to Phase 4 — tenant-specific policies.

      // 7. Wait for sandbox to be ready.
      await waitForHealthy(sandboxInfo.sandboxName);

      // 8. Update tenant record with sandbox info.
      await updateTenantSandbox(tenant.id, {
        name: sandboxInfo.sandboxName,
        port: sandboxInfo.port,
        host: sandboxInfo.host,
      });
      await updateTenantStatus(tenant.id, "active");

      // 9. Generate tenant API key for self-service endpoints.
      const apiKeyResult = await createApiKey({
        tenantId: tenant.id,
        scope: "tenant",
        label: `Auto-generated for ${tenant.slug}`,
      });

      // 10. Write audit log.
      await writeAuditLog({
        tenantId: tenant.id,
        actor,
        action: "tenant.provision",
        resourceType: "tenant",
        resourceId: tenant.id,
        details: {
          slug: tenant.slug,
          plan: tenant.plan,
          credentialMode: tenant.credentialMode,
          sandboxName: sandboxInfo.sandboxName,
          port: sandboxInfo.port,
        },
      });

      // Refetch tenant with updated sandbox info.
      const updatedTenant = await getTenant(tenant.id);

      return {
        tenant: updatedTenant ?? { ...tenant, status: "active" as const },
        sandboxToken,
        controlPlaneApiKey: apiKeyResult.key,
      };
    } catch (err) {
      // Rollback: mark tenant as failed.
      await updateTenantStatus(tenant.id, "suspended");
      await writeAuditLog({
        tenantId: tenant.id,
        actor,
        action: "tenant.provision.failed",
        resourceType: "tenant",
        resourceId: tenant.id,
        details: { error: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  }

  /**
   * Deprovision a tenant: stop sandbox, remove resources, soft-delete record.
   */
  async function deprovisionTenant(tenantId: string, actor: string): Promise<void> {
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found.`);
    }

    await updateTenantStatus(tenantId, "deprovisioning");

    // Remove the sandbox.
    if (tenant.sandboxName) {
      try {
        await runtime.removeSandbox(tenant.sandboxName);
      } catch (err) {
        console.error(
          `[orchestrator] Failed to remove sandbox for tenant ${tenant.slug}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // Soft-delete the tenant record.
    await deleteTenant(tenantId);

    await writeAuditLog({
      tenantId,
      actor,
      action: "tenant.deprovision",
      resourceType: "tenant",
      resourceId: tenantId,
      details: { slug: tenant.slug },
    });
  }

  /** Stop a tenant's sandbox (for hibernation or manual pause). */
  async function stopTenantSandbox(tenantId: string, actor: string): Promise<void> {
    const tenant = await getTenant(tenantId);
    if (!tenant?.sandboxName) {
      throw new Error(`Tenant ${tenantId} has no sandbox to stop.`);
    }

    await runtime.stopSandbox(tenant.sandboxName);

    await writeAuditLog({
      tenantId,
      actor,
      action: "tenant.sandbox.stop",
      resourceType: "tenant",
      resourceId: tenantId,
    });
  }

  /** Start a stopped tenant's sandbox (for wake from hibernation). */
  async function startTenantSandbox(tenantId: string, actor: string): Promise<void> {
    const tenant = await getTenant(tenantId);
    if (!tenant?.sandboxName) {
      throw new Error(`Tenant ${tenantId} has no sandbox to start.`);
    }

    await runtime.startSandbox(tenant.sandboxName);
    await waitForHealthy(tenant.sandboxName);

    await writeAuditLog({
      tenantId,
      actor,
      action: "tenant.sandbox.start",
      resourceType: "tenant",
      resourceId: tenantId,
    });
  }

  /** Restart a tenant's sandbox. */
  async function restartTenantSandbox(tenantId: string, actor: string): Promise<void> {
    const tenant = await getTenant(tenantId);
    if (!tenant?.sandboxName) {
      throw new Error(`Tenant ${tenantId} has no sandbox to restart.`);
    }

    await runtime.restartSandbox(tenant.sandboxName);

    await writeAuditLog({
      tenantId,
      actor,
      action: "tenant.sandbox.restart",
      resourceType: "tenant",
      resourceId: tenantId,
    });
  }

  /** Get the status of a tenant's sandbox. */
  async function getTenantSandboxStatus(tenantId: string) {
    const tenant = await getTenant(tenantId);
    if (!tenant?.sandboxName) {
      return { running: false, ready: false, state: "unknown" as const };
    }
    return runtime.getSandboxStatus(tenant.sandboxName);
  }

  /** Get logs from a tenant's sandbox. */
  async function getTenantSandboxLogs(tenantId: string, tail = 100): Promise<string> {
    const tenant = await getTenant(tenantId);
    if (!tenant?.sandboxName) {
      return "(no sandbox)";
    }
    return runtime.getSandboxLogs(tenant.sandboxName, tail);
  }

  // ── Internal Helpers ───────────────────────────────────────────

  /** Poll the sandbox status until it's ready or times out. */
  async function waitForHealthy(sandboxName: string): Promise<void> {
    const deadline = Date.now() + HEALTHCHECK_MAX_WAIT_MS;

    while (Date.now() < deadline) {
      const status = await runtime.getSandboxStatus(sandboxName);
      if (status.ready) {
        return;
      }

      if (status.state === "failed") {
        throw new Error(`Sandbox ${sandboxName} failed to start: ${status.message}`);
      }

      await new Promise((resolve) => setTimeout(resolve, HEALTHCHECK_POLL_INTERVAL_MS));
    }

    throw new Error(
      `Sandbox ${sandboxName} did not become ready within ${HEALTHCHECK_MAX_WAIT_MS}ms.`,
    );
  }

  return {
    provisionTenant,
    deprovisionTenant,
    stopTenantSandbox,
    startTenantSandbox,
    restartTenantSandbox,
    getTenantSandboxStatus,
    getTenantSandboxLogs,
  };
}

export type Orchestrator = ReturnType<typeof createOrchestrator>;
