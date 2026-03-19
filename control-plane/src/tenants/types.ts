// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Core tenant types for the NemoClaw multi-tenant SaaS platform.
//
// These types define the tenant data model used by the control plane
// to manage tenant lifecycle, billing, quotas, and sandbox provisioning.

/** UUID v4 tenant identifier. */
export type TenantId = string;

/** Tenant lifecycle states. */
export type TenantStatus = "provisioning" | "active" | "suspended" | "deprovisioning" | "deleted";

/** Billing plan tiers. Each tier maps to a resource tier and quota set. */
export type TenantPlan = "free" | "starter" | "pro" | "enterprise";

/**
 * How the tenant accesses AI providers:
 * - "platform": uses platform-operator-provided API keys (metered + billed)
 * - "byok": brings their own API keys (not metered by platform)
 * - "hybrid": tenant keys preferred, platform keys as fallback (only platform key usage metered)
 */
export type TenantCredentialMode = "platform" | "byok" | "hybrid";

/** Tenant activity states for hibernation management. */
export type TenantActivityState = "active" | "idle" | "hibernated" | "waking";

/** Core tenant record stored in PostgreSQL. */
export type Tenant = {
  /** UUID v4 primary key. */
  id: TenantId;
  /** URL-safe unique slug (alphanumeric + dashes, max 64 chars). Used in subdomain routing. */
  slug: string;
  /** Human-readable tenant name. */
  displayName: string;
  /** Current lifecycle status. */
  status: TenantStatus;
  /** Billing plan tier. */
  plan: TenantPlan;
  /** AI credential mode. */
  credentialMode: TenantCredentialMode;
  /** Primary contact email for billing and notifications. */
  contactEmail: string;
  /** OpenShell sandbox name (e.g., "tenant-slug--openclaw"). */
  sandboxName?: string;
  /** Forwarded sandbox port on the host. */
  sandboxPort?: number;
  /** Sandbox host (localhost or remote host). */
  sandboxHost?: string;
  /** Current activity state for hibernation. */
  activityState: TenantActivityState;
  /** ISO timestamp of last inbound message activity. */
  lastActivityAt?: string;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last update. */
  updatedAt: string;
  /** ISO timestamp of suspension (if suspended). */
  suspendedAt?: string;
  /** Reason for suspension (billing failure, abuse, manual, etc.). */
  suspendedReason?: string;
  /** Arbitrary key-value metadata for operator use. */
  metadata?: Record<string, string>;
};

/** Per-tenant quota limits, derived from the billing plan. */
export type TenantQuotas = {
  tenantId: TenantId;
  /** Maximum number of agents per tenant sandbox. */
  maxAgents: number;
  /** Maximum sessions per agent. */
  maxSessionsPerAgent: number;
  /** Maximum inbound messages per day. */
  maxMessagesPerDay: number;
  /** Maximum AI tokens per day (across all models). */
  maxTokensPerDay: number;
  /** Maximum AI cost per day in cents (USD). */
  maxCostPerDayCents: number;
  /** Maximum AI cost per month in cents (USD). */
  maxCostPerMonthCents: number;
  /** Maximum number of messaging channels configured. */
  maxChannels: number;
  /** Maximum persistent storage in bytes. */
  maxStorageBytes: number;
  /** Maximum number of sandboxes per tenant. */
  maxSandboxes: number;
};

/** Parameters for creating a new tenant. */
export type CreateTenantParams = {
  slug: string;
  displayName: string;
  plan: TenantPlan;
  credentialMode: TenantCredentialMode;
  contactEmail: string;
  metadata?: Record<string, string>;
};

/** Result of a successful tenant provisioning. */
export type TenantProvisionResult = {
  /** The created tenant record. */
  tenant: Tenant;
  /** Auto-generated sandbox auth token for this tenant's sandbox instance. */
  sandboxToken: string;
  /** Control plane API key scoped to this tenant (for self-service endpoints). */
  controlPlaneApiKey: string;
};

/** Pagination parameters for listing tenants. */
export type TenantListParams = {
  /** Filter by status. */
  status?: TenantStatus;
  /** Filter by plan. */
  plan?: TenantPlan;
  /** Search by slug or displayName. */
  search?: string;
  /** Number of results per page (default: 50, max: 200). */
  limit?: number;
  /** Offset for pagination. */
  offset?: number;
};

/** Paginated list result. */
export type TenantListResult = {
  tenants: Tenant[];
  total: number;
  limit: number;
  offset: number;
};

/** Default quotas per plan tier. */
export const DEFAULT_PLAN_QUOTAS: Record<TenantPlan, Omit<TenantQuotas, "tenantId">> = {
  free: {
    maxAgents: 1,
    maxSessionsPerAgent: 20,
    maxMessagesPerDay: 100,
    maxTokensPerDay: 100_000,
    maxCostPerDayCents: 100, // $1/day
    maxCostPerMonthCents: 1_000, // $10/month
    maxChannels: 1,
    maxStorageBytes: 100 * 1024 * 1024, // 100 MB
    maxSandboxes: 1,
  },
  starter: {
    maxAgents: 3,
    maxSessionsPerAgent: 100,
    maxMessagesPerDay: 1_000,
    maxTokensPerDay: 1_000_000,
    maxCostPerDayCents: 1_000, // $10/day
    maxCostPerMonthCents: 10_000, // $100/month
    maxChannels: 3,
    maxStorageBytes: 1024 * 1024 * 1024, // 1 GB
    maxSandboxes: 3,
  },
  pro: {
    maxAgents: 10,
    maxSessionsPerAgent: 500,
    maxMessagesPerDay: 10_000,
    maxTokensPerDay: 10_000_000,
    maxCostPerDayCents: 5_000, // $50/day
    maxCostPerMonthCents: 50_000, // $500/month
    maxChannels: 10,
    maxStorageBytes: 10 * 1024 * 1024 * 1024, // 10 GB
    maxSandboxes: 10,
  },
  enterprise: {
    maxAgents: 50,
    maxSessionsPerAgent: 2_000,
    maxMessagesPerDay: 100_000,
    maxTokensPerDay: 100_000_000,
    maxCostPerDayCents: 50_000, // $500/day
    maxCostPerMonthCents: 500_000, // $5,000/month
    maxChannels: 50,
    maxStorageBytes: 100 * 1024 * 1024 * 1024, // 100 GB
    maxSandboxes: 50,
  },
};
