// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Public API for the tenant management module.

// Types
export type {
  TenantId,
  TenantStatus,
  TenantPlan,
  TenantCredentialMode,
  TenantActivityState,
  Tenant,
  TenantQuotas,
  CreateTenantParams,
  TenantProvisionResult,
  TenantListParams,
  TenantListResult,
} from "./types.js";

export { DEFAULT_PLAN_QUOTAS } from "./types.js";

// Slug validation
export { validateTenantSlug, isValidTenantSlug } from "./tenant-id.js";
export type { TenantSlugValidation } from "./tenant-id.js";

// Tenant store (CRUD, API keys, audit)
export {
  createTenant,
  getTenant,
  getTenantBySlug,
  getTenantQuotas,
  listTenants,
  updateTenantStatus,
  suspendTenant,
  resumeTenant,
  deleteTenant,
  updateTenantSandbox,
  recordTenantActivity,
  updateTenantActivityState,
  getIdleTenants,
  createApiKey,
  validateApiKey,
  writeAuditLog,
} from "./tenant-store.js";

// Resource tiers
export type { ResourceTier } from "./resource-tiers.js";
export { DEFAULT_RESOURCE_TIERS } from "./resource-tiers.js";

// Tenant lifecycle coordinator
export { createTenantLifecycle } from "./tenant-lifecycle.js";
export type { TenantLifecycle, TenantLifecycleConfig } from "./tenant-lifecycle.js";
