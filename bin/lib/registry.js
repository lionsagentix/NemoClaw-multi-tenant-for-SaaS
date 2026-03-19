// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Multi-sandbox registry at ~/.nemoclaw/sandboxes.json

const fs = require("fs");
const path = require("path");

const GLOBAL_REGISTRY_FILE = path.join(process.env.HOME || "/tmp", ".nemoclaw", "sandboxes.json");

/**
 * Resolve the registry file path. If tenantId is provided, uses
 * ~/.nemoclaw/tenants/{tenantId}/sandboxes.json for tenant isolation.
 * Falls back to global ~/.nemoclaw/sandboxes.json for single-tenant mode.
 */
function registryPath(tenantId) {
  if (tenantId) {
    return path.join(process.env.HOME || "/tmp", ".nemoclaw", "tenants", tenantId, "sandboxes.json");
  }
  return GLOBAL_REGISTRY_FILE;
}

function load(tenantId) {
  const filePath = registryPath(tenantId);
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch {}
  return { sandboxes: {}, defaultSandbox: null };
}

function save(data, tenantId) {
  const filePath = registryPath(tenantId);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function getSandbox(name, tenantId) {
  const data = load(tenantId);
  return data.sandboxes[name] || null;
}

function getDefault(tenantId) {
  const data = load(tenantId);
  if (data.defaultSandbox && data.sandboxes[data.defaultSandbox]) {
    return data.defaultSandbox;
  }
  // Fall back to first sandbox if default is missing
  const names = Object.keys(data.sandboxes);
  return names.length > 0 ? names[0] : null;
}

function registerSandbox(entry, tenantId) {
  const data = load(tenantId);
  data.sandboxes[entry.name] = {
    name: entry.name,
    createdAt: entry.createdAt || new Date().toISOString(),
    model: entry.model || null,
    nimContainer: entry.nimContainer || null,
    provider: entry.provider || null,
    gpuEnabled: entry.gpuEnabled || false,
    policies: entry.policies || [],
  };
  if (!data.defaultSandbox) {
    data.defaultSandbox = entry.name;
  }
  save(data, tenantId);
}

function updateSandbox(name, updates, tenantId) {
  const data = load(tenantId);
  if (!data.sandboxes[name]) return false;
  Object.assign(data.sandboxes[name], updates);
  save(data, tenantId);
  return true;
}

function removeSandbox(name, tenantId) {
  const data = load(tenantId);
  if (!data.sandboxes[name]) return false;
  delete data.sandboxes[name];
  if (data.defaultSandbox === name) {
    const remaining = Object.keys(data.sandboxes);
    data.defaultSandbox = remaining.length > 0 ? remaining[0] : null;
  }
  save(data, tenantId);
  return true;
}

function listSandboxes(tenantId) {
  const data = load(tenantId);
  return {
    sandboxes: Object.values(data.sandboxes),
    defaultSandbox: data.defaultSandbox,
  };
}

function setDefault(name, tenantId) {
  const data = load(tenantId);
  if (!data.sandboxes[name]) return false;
  data.defaultSandbox = name;
  save(data, tenantId);
  return true;
}

module.exports = {
  load,
  save,
  getSandbox,
  getDefault,
  registerSandbox,
  updateSandbox,
  removeSandbox,
  listSandboxes,
  setDefault,
};
