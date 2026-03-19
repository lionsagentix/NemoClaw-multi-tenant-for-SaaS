// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Mock billing provider for development and testing.
//
// Logs all operations and stores state in-memory. Does not interact
// with any external payment service.

import type {
  BillingProvider,
  BillingCustomer,
  BillingSubscription,
  BillingEvent,
  Invoice,
  UsageMetric,
} from "../types.js";
import type { TenantId, TenantPlan } from "../../tenants/types.js";

/** Plan ID mapping for mock provider. */
const PLAN_IDS: Record<TenantPlan, string> = {
  free: "mock_plan_free",
  starter: "mock_plan_starter",
  pro: "mock_plan_pro",
  enterprise: "mock_plan_enterprise",
};

/**
 * Create a mock billing provider for development and testing.
 *
 * All operations log to console and store state in-memory.
 * State is lost when the process restarts.
 */
export function createMockBillingProvider(): BillingProvider {
  const customers = new Map<TenantId, BillingCustomer>();
  const subscriptions = new Map<TenantId, BillingSubscription>();
  const usageRecords: Array<{ tenantId: TenantId; metric: UsageMetric; quantity: number; timestamp: string }> = [];

  return {
    name: "mock",

    async createCustomer(tenantId: TenantId, email: string, name: string): Promise<BillingCustomer> {
      const customer: BillingCustomer = {
        tenantId,
        provider: "mock",
        externalCustomerId: `mock_cus_${tenantId.slice(0, 8)}`,
        createdAt: new Date().toISOString(),
      };
      customers.set(tenantId, customer);
      console.log(`[mock-billing] Created customer for tenant ${tenantId}: ${name} <${email}>`);
      return customer;
    },

    async updateSubscription(tenantId: TenantId, plan: TenantPlan): Promise<BillingSubscription> {
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      const subscription: BillingSubscription = {
        id: `mock_sub_${tenantId.slice(0, 8)}`,
        tenantId,
        provider: "mock",
        externalSubscriptionId: `mock_sub_${tenantId.slice(0, 8)}`,
        planId: PLAN_IDS[plan],
        status: "active",
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: periodEnd.toISOString(),
        cancelAtPeriodEnd: false,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      subscriptions.set(tenantId, subscription);
      console.log(`[mock-billing] Updated subscription for tenant ${tenantId}: plan=${plan}`);
      return subscription;
    },

    async cancelSubscription(tenantId: TenantId): Promise<void> {
      const sub = subscriptions.get(tenantId);
      if (sub) {
        sub.status = "canceled";
        sub.cancelAtPeriodEnd = true;
        sub.updatedAt = new Date().toISOString();
      }
      console.log(`[mock-billing] Canceled subscription for tenant ${tenantId}`);
    },

    async recordUsage(tenantId: TenantId, metric: UsageMetric, quantity: number): Promise<void> {
      usageRecords.push({
        tenantId,
        metric,
        quantity,
        timestamp: new Date().toISOString(),
      });
      console.log(`[mock-billing] Recorded usage for tenant ${tenantId}: ${metric}=${quantity}`);
    },

    async getInvoices(tenantId: TenantId, limit = 10): Promise<Invoice[]> {
      // Return a mock invoice for active subscriptions.
      const sub = subscriptions.get(tenantId);
      if (!sub) return [];

      return [
        {
          id: `mock_inv_${tenantId.slice(0, 8)}`,
          tenantId,
          provider: "mock",
          amountCents: 0, // Free in mock mode
          currency: "usd",
          status: "paid",
          periodStart: sub.currentPeriodStart ?? new Date().toISOString(),
          periodEnd: sub.currentPeriodEnd ?? new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ].slice(0, limit);
    },

    async handleWebhook(payload: string | Buffer, signature: string): Promise<BillingEvent> {
      console.log(`[mock-billing] Received webhook (signature: ${signature.slice(0, 16)}...)`);
      const data = typeof payload === "string" ? JSON.parse(payload) : JSON.parse(payload.toString());
      return {
        type: data.type || "mock.event",
        provider: "mock",
        data,
      };
    },
  };
}
