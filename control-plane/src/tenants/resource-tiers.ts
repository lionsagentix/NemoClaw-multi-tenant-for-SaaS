// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Per-plan resource tiers for tenant OpenShell sandboxes.
//
// Defines CPU, memory, storage, hibernation policy, and sandbox limits per billing plan.
// Used by the orchestrator to set sandbox resource limits.

import type { TenantPlan } from "./types.js";

/** Resource tier defining sandbox limits and hibernation behavior per plan. */
export type ResourceTier = {
  planId: TenantPlan;
  /** CPU request (K8s format, used by OpenShell resource limits). */
  cpu: string;
  /** CPU limit (burst ceiling). */
  cpuLimit: string;
  /** Memory request. */
  memory: string;
  /** Memory limit (hard cap, OOM kill). */
  memoryLimit: string;
  /** Ephemeral/persistent storage size. */
  ephemeralStorage: string;
  /** Maximum sandboxes for this tier. */
  maxSandboxes: number;
  /** Maximum inference requests per day. */
  maxInferenceRequestsPerDay: number;
  /** Hibernation policy for this tier. */
  hibernation: {
    /** If true, this tier is never hibernated. */
    exempt: boolean;
    /** Minutes of inactivity before marking as idle. */
    idleMinutes: number;
    /** Minutes of idle before hibernating (stopping sandbox). */
    hibernateMinutes: number;
  };
};

/** Default resource tiers per plan. */
export const DEFAULT_RESOURCE_TIERS: Record<TenantPlan, ResourceTier> = {
  free: {
    planId: "free",
    cpu: "250m",
    cpuLimit: "500m",
    memory: "128Mi",
    memoryLimit: "256Mi",
    ephemeralStorage: "1Gi",
    maxSandboxes: 1,
    maxInferenceRequestsPerDay: 100,
    hibernation: { exempt: false, idleMinutes: 15, hibernateMinutes: 30 },
  },
  starter: {
    planId: "starter",
    cpu: "500m",
    cpuLimit: "1000m",
    memory: "256Mi",
    memoryLimit: "512Mi",
    ephemeralStorage: "5Gi",
    maxSandboxes: 3,
    maxInferenceRequestsPerDay: 1_000,
    hibernation: { exempt: false, idleMinutes: 30, hibernateMinutes: 120 },
  },
  pro: {
    planId: "pro",
    cpu: "1000m",
    cpuLimit: "2000m",
    memory: "512Mi",
    memoryLimit: "1Gi",
    ephemeralStorage: "10Gi",
    maxSandboxes: 10,
    maxInferenceRequestsPerDay: 10_000,
    hibernation: { exempt: false, idleMinutes: 60, hibernateMinutes: 240 },
  },
  enterprise: {
    planId: "enterprise",
    cpu: "2000m",
    cpuLimit: "4000m",
    memory: "2Gi",
    memoryLimit: "4Gi",
    ephemeralStorage: "20Gi",
    maxSandboxes: 50,
    maxInferenceRequestsPerDay: 100_000,
    hibernation: { exempt: true, idleMinutes: 0, hibernateMinutes: 0 },
  },
};
