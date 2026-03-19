// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const GLOBAL_STATE_DIR = join(process.env.HOME ?? "/tmp", ".nemoclaw", "state");

/**
 * Resolve state directory. If tenantId is provided, uses per-tenant state.
 * Falls back to global state for single-tenant mode.
 */
function resolveStateDir(tenantId?: string): string {
  if (tenantId) {
    return join(process.env.HOME ?? "/tmp", ".nemoclaw", "tenants", tenantId, "state");
  }
  return GLOBAL_STATE_DIR;
}

export interface NemoClawState {
  lastRunId: string | null;
  lastAction: string | null;
  blueprintVersion: string | null;
  sandboxName: string | null;
  migrationSnapshot: string | null;
  hostBackupPath: string | null;
  createdAt: string | null;
  updatedAt: string;
}

const createdDirs = new Set<string>();

function ensureStateDir(tenantId?: string): void {
  const dir = resolveStateDir(tenantId);
  if (createdDirs.has(dir)) return;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  createdDirs.add(dir);
}

function statePath(tenantId?: string): string {
  return join(resolveStateDir(tenantId), "nemoclaw.json");
}

function blankState(): NemoClawState {
  return {
    lastRunId: null,
    lastAction: null,
    blueprintVersion: null,
    sandboxName: null,
    migrationSnapshot: null,
    hostBackupPath: null,
    createdAt: null,
    updatedAt: new Date().toISOString(),
  };
}

export function loadState(tenantId?: string): NemoClawState {
  ensureStateDir(tenantId);
  const path = statePath(tenantId);
  if (!existsSync(path)) {
    return blankState();
  }
  return JSON.parse(readFileSync(path, "utf-8")) as NemoClawState;
}

export function saveState(state: NemoClawState, tenantId?: string): void {
  ensureStateDir(tenantId);
  state.updatedAt = new Date().toISOString();
  if (!state.createdAt) state.createdAt = state.updatedAt;
  writeFileSync(statePath(tenantId), JSON.stringify(state, null, 2));
}

export function clearState(tenantId?: string): void {
  ensureStateDir(tenantId);
  const path = statePath(tenantId);
  if (existsSync(path)) {
    writeFileSync(path, JSON.stringify(blankState(), null, 2));
  }
}
