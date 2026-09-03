import assert from "node:assert/strict";
import test from "node:test";
import { normalizeManifest, statusFromHealth } from "../../ai-chat/src/lib/services/manager.ts";

test("normalizes directory service manifest", () => {
  const services = normalizeManifest("search", {
    group: "search",
    services: [
      {
        id: "search-service",
        name: "搜索编排服务",
        description: "Node service",
        cwd: "packages/services/search",
        start: ["node", "server.js"],
        stop: ["pkill", "-f", "packages/services/search/server.js"],
        health: { type: "http", url: "http://127.0.0.1:8090/health" },
      },
    ],
  });

  assert.equal(services[0].id, "search-service");
  assert.equal(services[0].group, "search");
  assert.equal(services[0].healthUrl, "http://127.0.0.1:8090/health");
});

test("maps health check result to minimal status", () => {
  assert.equal(statusFromHealth(true), "running");
  assert.equal(statusFromHealth(false), "stopped");
});
