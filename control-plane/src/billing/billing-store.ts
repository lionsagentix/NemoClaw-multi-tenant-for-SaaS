// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// PostgreSQL data access layer for billing state.
//
// Provides CRUD operations for billing_customers, billing_subscriptions,
// usage_records, and rate_limit_buckets tables.

import { getDb } from "../db/connection.js";
import type { TenantId } from "../tenants/types.js";
import type {
  BillingCustomer,
  BillingSubscription,
  BillingProviderName,
  SubscriptionStatus,
  UsageMetric,
} from "./types.js";

// ── Row Mappers ────────────────────────────────────────────────

function rowToCustomer(row: Record<string, unknown>): BillingCustomer {
  return {
    tenantId: row.tenant_id as string,
    provider: row.provider as BillingProviderName,
    externalCustomerId: row.external_customer_id as string,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

function rowToSubscription(row: Record<string, unknown>): BillingSubscription {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    provider: row.provider as BillingProviderName,
    externalSubscriptionId: row.external_subscription_id as string,
    planId: row.plan_id as string,
    status: row.status as SubscriptionStatus,
    currentPeriodStart: row.current_period_start
      ? (row.current_period_start as Date).toISOString()
      : undefined,
    currentPeriodEnd: row.current_period_end
      ? (row.current_period_end as Date).toISOString()
      : undefined,
    cancelAtPeriodEnd: (row.cancel_at_period_end as boolean) ?? false,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

// ── Billing Customers ──────────────────────────────────────────

/** Create or update a billing customer mapping for a tenant. */
export async function upsertBillingCustomer(
  tenantId: TenantId,
  provider: BillingProviderName,
  externalCustomerId: string,
): Promise<BillingCustomer> {
  const db = getDb();
  const result = await db.query(
    `INSERT INTO billing_customers (tenant_id, provider, external_customer_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id) DO UPDATE
       SET provider = $2, external_customer_id = $3
     RETURNING *`,
    [tenantId, provider, externalCustomerId],
  );
  return rowToCustomer(result.rows[0]);
}

/** Get the billing customer for a tenant. */
export async function getBillingCustomer(tenantId: TenantId): Promise<BillingCustomer | null> {
  const db = getDb();
  const result = await db.query(
    "SELECT * FROM billing_customers WHERE tenant_id = $1",
    [tenantId],
  );
  return result.rows.length > 0 ? rowToCustomer(result.rows[0]) : null;
}

/** Find a tenant by external customer ID (for webhook resolution). */
export async function findTenantByExternalCustomer(
  provider: BillingProviderName,
  externalCustomerId: string,
): Promise<TenantId | null> {
  const db = getDb();
  const result = await db.query(
    "SELECT tenant_id FROM billing_customers WHERE provider = $1 AND external_customer_id = $2",
    [provider, externalCustomerId],
  );
  return result.rows.length > 0 ? (result.rows[0].tenant_id as string) : null;
}

// ── Billing Subscriptions ──────────────────────────────────────

/** Create or update a subscription for a tenant. */
export async function upsertBillingSubscription(params: {
  tenantId: TenantId;
  provider: BillingProviderName;
  externalSubscriptionId: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
}): Promise<BillingSubscription> {
  const db = getDb();
  const result = await db.query(
    `INSERT INTO billing_subscriptions
       (tenant_id, provider, external_subscription_id, plan_id, status,
        current_period_start, current_period_end, cancel_at_period_end)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_id) DO UPDATE
       SET provider = $2,
           external_subscription_id = $3,
           plan_id = $4,
           status = $5,
           current_period_start = $6,
           current_period_end = $7,
           cancel_at_period_end = $8
     RETURNING *`,
    [
      params.tenantId,
      params.provider,
      params.externalSubscriptionId,
      params.planId,
      params.status,
      params.currentPeriodStart || null,
      params.currentPeriodEnd || null,
      params.cancelAtPeriodEnd ?? false,
    ],
  );
  return rowToSubscription(result.rows[0]);
}

/** Get active subscription for a tenant. */
export async function getBillingSubscription(
  tenantId: TenantId,
): Promise<BillingSubscription | null> {
  const db = getDb();
  const result = await db.query(
    `SELECT * FROM billing_subscriptions
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId],
  );
  return result.rows.length > 0 ? rowToSubscription(result.rows[0]) : null;
}

/** Update subscription status. */
export async function updateSubscriptionStatus(
  tenantId: TenantId,
  status: SubscriptionStatus,
): Promise<BillingSubscription | null> {
  const db = getDb();
  const result = await db.query(
    `UPDATE billing_subscriptions
     SET status = $2
     WHERE tenant_id = $1
     RETURNING *`,
    [tenantId, status],
  );
  return result.rows.length > 0 ? rowToSubscription(result.rows[0]) : null;
}

// ── Usage Records ──────────────────────────────────────────────

/** Record AI usage for a tenant. */
export async function recordUsage(params: {
  tenantId: TenantId;
  agentId?: string;
  date: Date;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  messageCount?: number;
}): Promise<void> {
  const db = getDb();
  await db.query(
    `INSERT INTO usage_records
       (tenant_id, agent_id, date, provider, model,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        total_tokens, estimated_cost_usd, message_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      params.tenantId,
      params.agentId || null,
      params.date,
      params.provider || null,
      params.model || null,
      params.inputTokens ?? 0,
      params.outputTokens ?? 0,
      params.cacheReadTokens ?? 0,
      params.cacheWriteTokens ?? 0,
      params.totalTokens ?? 0,
      params.estimatedCostUsd ?? 0,
      params.messageCount ?? 0,
    ],
  );
}

/** Get aggregated usage for a tenant within a date range. */
export async function getUsageSummary(
  tenantId: TenantId,
  startDate: Date,
  endDate: Date,
): Promise<{
  totalTokens: number;
  totalMessages: number;
  estimatedCostUsd: number;
  days: number;
}> {
  const db = getDb();
  const result = await db.query(
    `SELECT
       COALESCE(SUM(total_tokens), 0) AS total_tokens,
       COALESCE(SUM(message_count), 0) AS total_messages,
       COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd,
       COUNT(DISTINCT date) AS days
     FROM usage_records
     WHERE tenant_id = $1
       AND date >= $2
       AND date < $3`,
    [tenantId, startDate, endDate],
  );

  const row = result.rows[0];
  return {
    totalTokens: Number(row.total_tokens),
    totalMessages: Number(row.total_messages),
    estimatedCostUsd: Number(row.estimated_cost_usd),
    days: Number(row.days),
  };
}

/** Get daily usage breakdown for a tenant. */
export async function getDailyUsage(
  tenantId: TenantId,
  startDate: Date,
  endDate: Date,
): Promise<
  Array<{
    date: string;
    totalTokens: number;
    messageCount: number;
    estimatedCostUsd: number;
  }>
> {
  const db = getDb();
  const result = await db.query(
    `SELECT
       date,
       COALESCE(SUM(total_tokens), 0) AS total_tokens,
       COALESCE(SUM(message_count), 0) AS message_count,
       COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
     FROM usage_records
     WHERE tenant_id = $1
       AND date >= $2
       AND date < $3
     GROUP BY date
     ORDER BY date ASC`,
    [tenantId, startDate, endDate],
  );

  return result.rows.map((row) => ({
    date: (row.date as Date).toISOString().slice(0, 10),
    totalTokens: Number(row.total_tokens),
    messageCount: Number(row.message_count),
    estimatedCostUsd: Number(row.estimated_cost_usd),
  }));
}

// ── Rate Limit Buckets ─────────────────────────────────────────

/** Get or create a rate limit bucket for a tenant. */
export async function getRateLimitBucket(
  tenantId: TenantId,
  quotaId: string,
  windowStart: Date,
): Promise<{ currentValue: number }> {
  const db = getDb();
  const result = await db.query(
    `INSERT INTO rate_limit_buckets (tenant_id, quota_id, window_start, current_value)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (tenant_id, quota_id, window_start)
     DO NOTHING
     RETURNING current_value`,
    [tenantId, quotaId, windowStart],
  );

  if (result.rows.length > 0) {
    return { currentValue: Number(result.rows[0].current_value) };
  }

  // ON CONFLICT DO NOTHING means the row existed — fetch it.
  const existing = await db.query(
    `SELECT current_value FROM rate_limit_buckets
     WHERE tenant_id = $1 AND quota_id = $2 AND window_start = $3`,
    [tenantId, quotaId, windowStart],
  );

  return {
    currentValue: existing.rows.length > 0 ? Number(existing.rows[0].current_value) : 0,
  };
}

/** Increment a rate limit bucket and return the new value. */
export async function incrementRateLimitBucket(
  tenantId: TenantId,
  quotaId: string,
  windowStart: Date,
  increment: number,
): Promise<{ currentValue: number }> {
  const db = getDb();
  const result = await db.query(
    `INSERT INTO rate_limit_buckets (tenant_id, quota_id, window_start, current_value)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, quota_id, window_start)
     DO UPDATE SET current_value = rate_limit_buckets.current_value + $4
     RETURNING current_value`,
    [tenantId, quotaId, windowStart, increment],
  );
  return { currentValue: Number(result.rows[0].current_value) };
}

/** Clean up expired rate limit windows. */
export async function cleanupRateLimitBuckets(olderThanDays = 90): Promise<number> {
  const db = getDb();
  const result = await db.query(
    `DELETE FROM rate_limit_buckets
     WHERE window_start < NOW() - ($1 || ' days')::INTERVAL`,
    [olderThanDays],
  );
  return result.rowCount ?? 0;
}
