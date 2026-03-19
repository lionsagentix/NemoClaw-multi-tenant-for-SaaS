// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Billing provider factory.
//
// Creates the appropriate billing provider implementation based on configuration.
// Provider selection is configuration-driven: NEMOCLAW_CP_BILLING_PROVIDER env var.

import type { BillingProvider, PaymentProviderConfig } from "./types.js";
import { createMockBillingProvider } from "./providers/mock.js";

/**
 * Create a billing provider from configuration.
 *
 * This is the single entry point for billing provider creation.
 * Add new providers here as they're implemented.
 */
export function createBillingProvider(config: PaymentProviderConfig): BillingProvider {
  switch (config.provider) {
    case "mock":
      return createMockBillingProvider();

    // Future providers:
    // case "stripe":
    //   return createStripeBillingProvider(config);
    // case "paddle":
    //   return createPaddleBillingProvider(config);
    // case "lemonsqueezy":
    //   return createLemonSqueezyBillingProvider(config);

    default:
      throw new Error(
        `Unknown billing provider: "${config.provider}". ` +
        `Supported providers: mock, stripe, paddle, lemonsqueezy.`,
      );
  }
}
