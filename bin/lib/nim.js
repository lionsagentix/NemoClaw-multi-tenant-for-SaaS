// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// NIM container management — pull, start, stop, health-check NIM images.

const { run, runCapture } = require("./runner");
const nimImages = require("./nim-images.json");

function containerName(sandboxName) {
  return `nemoclaw-nim-${sandboxName}`;
}

function getImageForModel(modelName) {
  const entry = nimImages.models.find((m) => m.name === modelName);
  return entry ? entry.image : null;
}

function listModels() {
  return nimImages.models.map((m) => ({
    name: m.name,
    image: m.image,
    minGpuMemoryMB: m.minGpuMemoryMB,
  }));
}

function detectGpu() {
  // Try NVIDIA first — query VRAM
  try {
    const output = runCapture(
      "nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits",
      { ignoreError: true }
    );
    if (output) {
      const lines = output.split("\n").filter((l) => l.trim());
      const perGpuMB = lines.map((l) => parseInt(l.trim(), 10)).filter((n) => !isNaN(n));
      if (perGpuMB.length > 0) {
        const totalMemoryMB = perGpuMB.reduce((a, b) => a + b, 0);
        return {
          type: "nvidia",
          count: perGpuMB.length,
          totalMemoryMB,
          perGpuMB: perGpuMB[0],
          nimCapable: true,
        };
      }
    }
  } catch {}

  // Fallback: DGX Spark (GB10) — VRAM not queryable due to unified memory architecture
  try {
    const nameOutput = runCapture(
      "nvidia-smi --query-gpu=name --format=csv,noheader,nounits",
      { ignoreError: true }
    );
    if (nameOutput && nameOutput.includes("GB10")) {
      // GB10 has 128GB unified memory shared with Grace CPU — use system RAM
      let totalMemoryMB = 0;
      try {
        const memLine = runCapture("free -m | awk '/Mem:/ {print $2}'", { ignoreError: true });
        if (memLine) totalMemoryMB = parseInt(memLine.trim(), 10) || 0;
      } catch {}
      return {
        type: "nvidia",
        count: 1,
        totalMemoryMB,
        perGpuMB: totalMemoryMB,
        nimCapable: true,
        spark: true,
      };
    }
  } catch {}

  // macOS: detect Apple Silicon or discrete GPU
  if (process.platform === "darwin") {
    try {
      const spOutput = runCapture(
        "system_profiler SPDisplaysDataType 2>/dev/null",
        { ignoreError: true }
      );
      if (spOutput) {
        const chipMatch = spOutput.match(/Chipset Model:\s*(.+)/);
        const vramMatch = spOutput.match(/VRAM.*?:\s*(\d+)\s*(MB|GB)/i);
        const coresMatch = spOutput.match(/Total Number of Cores:\s*(\d+)/);

        if (chipMatch) {
          const name = chipMatch[1].trim();
          let memoryMB = 0;

          if (vramMatch) {
            memoryMB = parseInt(vramMatch[1], 10);
            if (vramMatch[2].toUpperCase() === "GB") memoryMB *= 1024;
          } else {
            // Apple Silicon shares system RAM — read total memory
            try {
              const memBytes = runCapture("sysctl -n hw.memsize", { ignoreError: true });
              if (memBytes) memoryMB = Math.floor(parseInt(memBytes, 10) / 1024 / 1024);
            } catch {}
          }

          return {
            type: "apple",
            name,
            count: 1,
            cores: coresMatch ? parseInt(coresMatch[1], 10) : null,
            totalMemoryMB: memoryMB,
            perGpuMB: memoryMB,
            nimCapable: false,
          };
        }
      }
    } catch {}
  }

  return null;
}

function pullNimImage(model) {
  const image = getImageForModel(model);
  if (!image) {
    console.error(`  Unknown model: ${model}`);
    process.exit(1);
  }
  console.log(`  Pulling NIM image: ${image}`);
  run(`docker pull ${image}`);
  return image;
}

function startNimContainer(sandboxName, model, port = 8000) {
  const name = containerName(sandboxName);
  const image = getImageForModel(model);
  if (!image) {
    console.error(`  Unknown model: ${model}`);
    process.exit(1);
  }

  // Stop any existing container with same name
  run(`docker rm -f ${name} 2>/dev/null || true`, { ignoreError: true });

  // Mount NGC credentials if available — some NIM images require NGC auth
  // for model download on first run. From OpenClaw 0ed64f124d.
  const ngcConfigPath = require("path").join(process.env.HOME || "/tmp", ".nv");
  const ngcMount = require("fs").existsSync(ngcConfigPath) ? `-v "${ngcConfigPath}:/root/.nv:ro"` : "";

  console.log(`  Starting NIM container: ${name}`);
  run(
    `docker run -d --gpus all -p ${port}:8000 --name ${name} --shm-size 16g ${ngcMount} ${image}`
  );
  return name;
}

function waitForNimHealth(port = 8000, timeout) {
  // Allow configurable timeout via env var for large models on DGX Spark
  // or multi-GPU setups that need longer startup. From OpenClaw f77a684131.
  const envTimeout = parseInt(process.env.NEMOCLAW_NIM_HEALTH_TIMEOUT, 10);
  const effectiveTimeout = timeout ?? (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 300);
  const start = Date.now();
  // Exponential backoff: start at 5s, double up to 30s cap.
  // From OpenClaw 44304ba24a — avoids hammering health endpoint.
  let interval = 5;
  const maxInterval = 30;
  console.log(`  Waiting for NIM health on port ${port} (timeout: ${effectiveTimeout}s)...`);

  while ((Date.now() - start) / 1000 < effectiveTimeout) {
    try {
      const result = runCapture(`curl -sf http://localhost:${port}/v1/models`, {
        ignoreError: true,
      });
      if (result) {
        console.log("  NIM is healthy.");
        return true;
      }
    } catch {}
    require("child_process").spawnSync("sleep", [String(interval)]);
    interval = Math.min(interval * 2, maxInterval);
  }
  console.error(`  NIM did not become healthy within ${effectiveTimeout}s.`);
  return false;
}

function stopNimContainer(sandboxName) {
  const name = containerName(sandboxName);
  console.log(`  Stopping NIM container: ${name}`);
  run(`docker stop ${name} 2>/dev/null || true`, { ignoreError: true });
  run(`docker rm ${name} 2>/dev/null || true`, { ignoreError: true });
}

function nimStatus(sandboxName) {
  const name = containerName(sandboxName);
  try {
    const state = runCapture(
      `docker inspect --format '{{.State.Status}}' ${name} 2>/dev/null`,
      { ignoreError: true }
    );
    if (!state) return { running: false, container: name };

    let healthy = false;
    if (state === "running") {
      const health = runCapture(`curl -sf http://localhost:8000/v1/models 2>/dev/null`, {
        ignoreError: true,
      });
      healthy = !!health;
    }
    return { running: state === "running", healthy, container: name, state };
  } catch {
    return { running: false, container: name };
  }
}

module.exports = {
  containerName,
  getImageForModel,
  listModels,
  detectGpu,
  pullNimImage,
  startNimContainer,
  waitForNimHealth,
  stopNimContainer,
  nimStatus,
};
