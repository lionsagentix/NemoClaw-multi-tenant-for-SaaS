// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// NemoClaw Multi-Tenant Control Plane — entry point.

// Database
export { initDb, getDb, closeDb, checkDbHealth } from "./db/connection.js";

// Tenant management
export * from "./tenants/index.js";

// Orchestration
export { createOpenShellRuntime, buildSandboxName, parseSandboxName } from "./orchestrator/openshell-runtime.js";
export type { OpenShellRuntime, SandboxStatus, SandboxInfo, OpenShellRuntimeConfig } from "./orchestrator/openshell-runtime.js";
export { createOrchestrator } from "./orchestrator/orchestrator.js";
export type { Orchestrator, OrchestratorConfig } from "./orchestrator/orchestrator.js";
export { generateTenantConfig, validateTenantSandboxSecurity } from "./orchestrator/config-generator.js";
export type { TenantInferenceConfig, TenantSandboxConfig, PlatformKeys } from "./orchestrator/config-generator.js";
export { startHealthMonitor } from "./orchestrator/health-monitor.js";
export type { HealthMonitor, HealthMonitorConfig } from "./orchestrator/health-monitor.js";
export { createProxyRouter } from "./orchestrator/proxy-router.js";
export type { ProxyRouter, TenantRoute } from "./orchestrator/proxy-router.js";

// Billing
export { createBillingProvider } from "./billing/billing-provider.js";
export type { BillingProvider, PaymentProviderConfig, BillingCustomer, BillingSubscription, BillingEvent, Invoice, UsageMetric } from "./billing/types.js";
export {
  upsertBillingCustomer,
  getBillingCustomer,
  findTenantByExternalCustomer,
  upsertBillingSubscription,
  getBillingSubscription,
  updateSubscriptionStatus,
  recordUsage,
  getUsageSummary,
  getDailyUsage,
  getRateLimitBucket,
  incrementRateLimitBucket,
  cleanupRateLimitBuckets,
} from "./billing/billing-store.js";
