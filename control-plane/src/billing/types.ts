// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Payment-provider-agnostic billing types.
//
// Per CLAUDE.md: billing must be provider-agnostic because tenants
// will have different provider setups.

import type { TenantId, TenantPlan } from "../tenants/types.js";

/** Supported billing provider names. Extensible — add new providers here. */
export type BillingProviderName = "stripe" | "paddle" | "lemonsqueezy" | "mock" | string;

/** Configuration for initializing a billing provider. */
export type PaymentProviderConfig = {
  provider: BillingProviderName;
  apiKey?: string;
  webhookSecret?: string;
  /** Provider-specific additional config. */
  options?: Record<string, string>;
};

/** A customer record linking a tenant to an external billing provider customer. */
export type BillingCustomer = {
  tenantId: TenantId;
  provider: BillingProviderName;
  externalCustomerId: string;
  createdAt: string;
};

/** Subscription status values. */
export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled" | "unpaid";

/** A subscription linking a tenant to a billing plan. */
export type BillingSubscription = {
  id: string;
  tenantId: TenantId;
  provider: BillingProviderName;
  externalSubscriptionId: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
};

/** A billing event received from a provider webhook. */
export type BillingEvent = {
  type: string;
  provider: BillingProviderName;
  tenantId?: TenantId;
  externalCustomerId?: string;
  externalSubscriptionId?: string;
  data: Record<string, unknown>;
};

/** An invoice from the billing provider. */
export type Invoice = {
  id: string;
  tenantId: TenantId;
  provider: BillingProviderName;
  amountCents: number;
  currency: string;
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  periodStart: string;
  periodEnd: string;
  pdfUrl?: string;
  createdAt: string;
};

/** Usage metric identifier. */
export type UsageMetric = "sandbox_hours" | "inference_requests" | "inference_tokens" | "storage_bytes";

/**
 * Abstract billing provider interface.
 *
 * This is the ONLY coupling point between the platform and billing providers.
 * Tenant code never imports provider-specific modules.
 */
export interface BillingProvider {
  /** Provider name (e.g., "stripe", "paddle"). */
  readonly name: BillingProviderName;

  /** Create a customer in the billing provider for a tenant. */
  createCustomer(tenantId: TenantId, email: string, name: string): Promise<BillingCustomer>;

  /** Create or update a subscription for a tenant. */
  updateSubscription(tenantId: TenantId, plan: TenantPlan): Promise<BillingSubscription>;

  /** Cancel a tenant's subscription. */
  cancelSubscription(tenantId: TenantId): Promise<void>;

  /** Record usage for metered billing. */
  recordUsage(tenantId: TenantId, metric: UsageMetric, quantity: number): Promise<void>;

  /** Get invoices for a tenant. */
  getInvoices(tenantId: TenantId, limit?: number): Promise<Invoice[]>;

  /** Handle an incoming webhook payload from the provider. */
  handleWebhook(payload: string | Buffer, signature: string): Promise<BillingEvent>;
}
