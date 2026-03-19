// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Per-tenant sandbox health monitor.
//
// Polls all active tenant sandboxes on a regular interval.
// Auto-restarts on failures and suspends on persistent failure.

import { listTenants, suspendTenant, writeAuditLog } from "../tenants/tenant-store.js";
import type { Tenant } from "../tenants/types.js";
import type { OpenShellRuntime } from "./openshell-runtime.js";

const DEFAULT_CHECK_INTERVAL_MS = 3 * 60_000; // 3 minutes
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 5;
const DEFAULT_MAX_RESTARTS_PER_HOUR = 3;
const ONE_HOUR_MS = 60 * 60_000;

export type HealthMonitorConfig = {
  /** OpenShell runtime for status checks and restarts. */
  runtime: OpenShellRuntime;
  /** Check interval in milliseconds. Default: 3 minutes. */
  checkIntervalMs?: number;
  /** Consecutive failures before auto-restart. Default: 5. */
  maxConsecutiveFailures?: number;
  /** Maximum auto-restarts per hour per tenant. Default: 3. */
  maxRestartsPerHour?: number;
  /** AbortSignal for graceful shutdown. */
  abortSignal?: AbortSignal;
};

export type HealthMonitor = {
  /** Stop the health monitor. */
  stop: () => void;
};

type TenantHealthState = {
  consecutiveFailures: number;
  restartTimestamps: number[];
  lastCheckAt?: number;
  lastHealthy?: boolean;
};

/**
 * Start the health monitor.
 *
 * Polls all active tenant sandboxes on a regular interval.
 * If a sandbox fails health checks repeatedly, it gets restarted.
 * If restarts don't fix it, the tenant is suspended.
 */
export function startHealthMonitor(config: HealthMonitorConfig): HealthMonitor {
  const {
    runtime,
    checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
    maxConsecutiveFailures = DEFAULT_MAX_CONSECUTIVE_FAILURES,
    maxRestartsPerHour = DEFAULT_MAX_RESTARTS_PER_HOUR,
    abortSignal,
  } = config;

  const healthStates = new Map<string, TenantHealthState>();
  let stopped = false;

  /** Get or initialize health state for a tenant. */
  function getState(tenantId: string): TenantHealthState {
    let state = healthStates.get(tenantId);
    if (!state) {
      state = { consecutiveFailures: 0, restartTimestamps: [] };
      healthStates.set(tenantId, state);
    }
    return state;
  }

  /** Prune restart timestamps older than 1 hour. */
  function pruneRestartTimestamps(state: TenantHealthState): void {
    const cutoff = Date.now() - ONE_HOUR_MS;
    state.restartTimestamps = state.restartTimestamps.filter((ts) => ts > cutoff);
  }

  /** Check health of a single tenant sandbox. */
  async function checkTenantHealth(tenant: Tenant): Promise<void> {
    if (!tenant.sandboxName) {
      return;
    }

    const state = getState(tenant.id);
    state.lastCheckAt = Date.now();

    try {
      const status = await runtime.getSandboxStatus(tenant.sandboxName);

      if (status.ready) {
        // Healthy — reset failure counter.
        if (!state.lastHealthy) {
          await writeAuditLog({
            tenantId: tenant.id,
            actor: "health-monitor",
            action: "tenant.sandbox.recovered",
            resourceType: "tenant",
            resourceId: tenant.id,
          });
        }
        state.consecutiveFailures = 0;
        state.lastHealthy = true;
        return;
      }

      // Not ready — increment failure counter.
      state.consecutiveFailures++;
      state.lastHealthy = false;

      if (state.consecutiveFailures < maxConsecutiveFailures) {
        return;
      }

      // Exceeded failure threshold — attempt restart or suspend.
      pruneRestartTimestamps(state);

      if (state.restartTimestamps.length >= maxRestartsPerHour) {
        // Too many restarts — suspend the tenant.
        console.error(
          `[health-monitor] Tenant ${tenant.slug} exceeded restart budget. Suspending.`,
        );

        await suspendTenant(
          tenant.id,
          "Automated: sandbox unhealthy after multiple restart attempts",
        );

        await writeAuditLog({
          tenantId: tenant.id,
          actor: "health-monitor",
          action: "tenant.suspend.auto",
          resourceType: "tenant",
          resourceId: tenant.id,
          details: {
            reason: "Sandbox unhealthy after max restart attempts",
            consecutiveFailures: state.consecutiveFailures,
            restartsThisHour: state.restartTimestamps.length,
          },
        });

        healthStates.delete(tenant.id);
        return;
      }

      // Attempt restart.
      console.warn(
        `[health-monitor] Tenant ${tenant.slug} failed ${state.consecutiveFailures} consecutive checks. Restarting.`,
      );

      await runtime.restartSandbox(tenant.sandboxName);
      state.restartTimestamps.push(Date.now());
      state.consecutiveFailures = 0;

      await writeAuditLog({
        tenantId: tenant.id,
        actor: "health-monitor",
        action: "tenant.sandbox.restart.auto",
        resourceType: "tenant",
        resourceId: tenant.id,
        details: {
          restartsThisHour: state.restartTimestamps.length,
        },
      });
    } catch (err) {
      state.consecutiveFailures++;
      state.lastHealthy = false;
      console.error(
        `[health-monitor] Error checking tenant ${tenant.slug}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  /** Run a full health check cycle across all active tenants. */
  async function runCycle(): Promise<void> {
    try {
      const result = await listTenants({ status: "active", limit: 200 });
      const activeTenants = result.tenants.filter(
        (t) => t.sandboxName && t.activityState !== "hibernated",
      );

      // Check all tenants concurrently (bounded to avoid overwhelming the system).
      const CONCURRENCY = 10;
      for (let i = 0; i < activeTenants.length; i += CONCURRENCY) {
        const batch = activeTenants.slice(i, i + CONCURRENCY);
        await Promise.allSettled(batch.map((t) => checkTenantHealth(t)));
      }

      // Clean up states for tenants no longer active.
      const activeIds = new Set(activeTenants.map((t) => t.id));
      for (const id of healthStates.keys()) {
        if (!activeIds.has(id)) {
          healthStates.delete(id);
        }
      }
    } catch (err) {
      console.error(
        "[health-monitor] Error during health check cycle:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Start the interval.
  const interval = setInterval(() => {
    if (!stopped) {
      void runCycle();
    }
  }, checkIntervalMs);

  // Handle abort signal for graceful shutdown.
  if (abortSignal) {
    abortSignal.addEventListener("abort", () => {
      stopped = true;
      clearInterval(interval);
    });
  }

  // Run first cycle after a short startup delay.
  setTimeout(() => {
    if (!stopped) {
      void runCycle();
    }
  }, 10_000);

  return {
    stop() {
      stopped = true;
      clearInterval(interval);
      healthStates.clear();
    },
  };
}
