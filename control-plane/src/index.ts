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
export { generateTenantConfig } from "./orchestrator/config-generator.js";
export type { TenantInferenceConfig, TenantSandboxConfig, PlatformKeys } from "./orchestrator/config-generator.js";
export { startHealthMonitor } from "./orchestrator/health-monitor.js";
export type { HealthMonitor, HealthMonitorConfig } from "./orchestrator/health-monitor.js";
export { createProxyRouter } from "./orchestrator/proxy-router.js";
export type { ProxyRouter, TenantRoute } from "./orchestrator/proxy-router.js";
