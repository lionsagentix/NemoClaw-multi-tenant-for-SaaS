// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Tenant lifecycle coordinator.
//
// High-level operations that combine tenant store (database), orchestrator
// (sandbox management), and proxy router (traffic routing) into complete
// lifecycle workflows.
//
// This is the primary API that the control plane server calls for tenant
// management operations.

import type { Orchestrator } from "../orchestrator/orchestrator.js";
import type { ProxyRouter } from "../orchestrator/proxy-router.js";
import {
  getTenant,
  getTenantBySlug,
  getTenantQuotas,
  listTenants,
  resumeTenant,
  updateTenantStatus,
  writeAuditLog,
} from "./tenant-store.js";
import type {
  CreateTenantParams,
  Tenant,
  TenantId,
  TenantListParams,
  TenantListResult,
  TenantProvisionResult,
  TenantQuotas,
} from "./types.js";

export type TenantLifecycleConfig = {
  orchestrator: Orchestrator;
  proxyRouter: ProxyRouter;
};

/**
 * Create a tenant lifecycle coordinator.
 *
 * Provides the high-level operations used by the control plane API.
 */
export function createTenantLifecycle(config: TenantLifecycleConfig) {
  const { orchestrator, proxyRouter } = config;

  /**
   * Create and provision a new tenant (full flow).
   *
   * 1. Creates tenant record
   * 2. Provisions OpenShell sandbox
   * 3. Configures inference
   * 4. Waits for healthcheck
   * 5. Updates proxy routing table
   * 6. Returns tenant credentials
   */
  async function createAndProvision(
    params: CreateTenantParams,
    actor: string,
  ): Promise<TenantProvisionResult> {
    const result = await orchestrator.provisionTenant(params, actor);

    // Update the proxy routing table.
    await proxyRouter.refresh();

    return result;
  }

  /**
   * Suspend a tenant.
   *
   * Stops the sandbox and removes from routing.
   * Tenant data is preserved for resumption.
   */
  async function suspend(
    tenantId: TenantId,
    reason: string,
    actor: string,
  ): Promise<Tenant | null> {
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      return null;
    }

    // Stop the sandbox.
    try {
      await orchestrator.stopTenantSandbox(tenantId, actor);
    } catch (err) {
      console.error(
        `[tenant-lifecycle] Error stopping sandbox for ${tenant.slug}:`,
        err instanceof Error ? err.message : err,
      );
    }

    // Update status in database.
    await updateTenantStatus(tenantId, "suspended");

    // Remove from routing.
    proxyRouter.setHealth(tenant.slug, false);

    await writeAuditLog({
      tenantId,
      actor,
      action: "tenant.suspend",
      resourceType: "tenant",
      resourceId: tenantId,
      details: { reason },
    });

    return getTenant(tenantId);
  }

  /**
   * Resume a suspended tenant.
   *
   * Restarts the sandbox and restores routing.
   */
  async function resume(tenantId: TenantId, actor: string): Promise<Tenant | null> {
    const tenant = await getTenant(tenantId);
    if (!tenant || tenant.status !== "suspended") {
      return null;
    }

    // Resume in database.
    await resumeTenant(tenantId);

    // Start the sandbox.
    try {
      await orchestrator.startTenantSandbox(tenantId, actor);
    } catch (err) {
      // If start fails, re-suspend.
      await updateTenantStatus(tenantId, "suspended");
      throw err;
    }

    // Restore routing.
    await proxyRouter.refresh();

    await writeAuditLog({
      tenantId,
      actor,
      action: "tenant.resume",
      resourceType: "tenant",
      resourceId: tenantId,
    });

    return getTenant(tenantId);
  }

  /**
   * Permanently delete a tenant.
   *
   * Stops sandbox, removes it, soft-deletes records.
   * Sandbox data is preserved for backup/compliance.
   */
  async function remove(tenantId: TenantId, actor: string): Promise<void> {
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found.`);
    }

    await orchestrator.deprovisionTenant(tenantId, actor);

    // Remove from routing.
    proxyRouter.setHealth(tenant.slug, false);
    await proxyRouter.refresh();
  }

  /**
   * Get tenant details with sandbox status.
   */
  async function getDetails(tenantId: TenantId): Promise<{
    tenant: Tenant;
    quotas: TenantQuotas | null;
    sandboxStatus: Awaited<ReturnType<Orchestrator["getTenantSandboxStatus"]>>;
  } | null> {
    const tenant = await getTenant(tenantId);
    if (!tenant) {
      return null;
    }

    const [quotas, sandboxStatus] = await Promise.all([
      getTenantQuotas(tenantId),
      orchestrator.getTenantSandboxStatus(tenantId),
    ]);

    return { tenant, quotas, sandboxStatus };
  }

  /**
   * Get tenant details by slug.
   */
  async function getBySlug(slug: string): Promise<Tenant | null> {
    return getTenantBySlug(slug);
  }

  /**
   * List tenants with filtering and pagination.
   */
  async function list(params: TenantListParams): Promise<TenantListResult> {
    return listTenants(params);
  }

  /**
   * Restart a tenant's sandbox.
   */
  async function restartSandbox(tenantId: TenantId, actor: string): Promise<void> {
    await orchestrator.restartTenantSandbox(tenantId, actor);
  }

  /**
   * Get sandbox logs for a tenant.
   */
  async function getSandboxLogs(tenantId: TenantId, tail = 100): Promise<string> {
    return orchestrator.getTenantSandboxLogs(tenantId, tail);
  }

  return {
    createAndProvision,
    suspend,
    resume,
    remove,
    getDetails,
    getBySlug,
    list,
    restartSandbox,
    getSandboxLogs,
  };
}

export type TenantLifecycle = ReturnType<typeof createTenantLifecycle>;
