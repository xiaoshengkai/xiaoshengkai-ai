import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type ServiceStatus = "running" | "starting" | "stopped" | "unknown";

type ManifestService = {
  id: string;
  name: string;
  description?: string;
  cwd: string;
  start: string[];
  stop: string[];
  health?: { type: "http"; url: string };
};

type ServiceDef = ManifestService & { group: string; healthUrl: string };

export type ManagedService = {
  id: string;
  group: string;
  name: string;
  description: string;
  cwd: string;
  healthUrl: string;
  status: ServiceStatus;
};

const PROJECT_ROOT = path.resolve(process.cwd(), "..", "..");
const SERVICES_DIR = path.join(PROJECT_ROOT, "packages", "services");
const pending = new Map<string, number>();

export function statusFromHealth(ok: boolean): ServiceStatus {
  return ok ? "running" : "stopped";
}

export function normalizeManifest(defaultGroup: string, manifest: { group?: string; services?: ManifestService[] }): ServiceDef[] {
  const group = manifest.group || defaultGroup;
  return (manifest.services || []).map((service) => ({
    ...service,
    group,
    description: service.description || "",
    healthUrl: service.health?.url || "",
  }));
}

function readDefinitions(): { services: ServiceDef[]; errors: string[] } {
  const services: ServiceDef[] = [];
  const errors: string[] = [];
  if (!existsSync(SERVICES_DIR)) return { services, errors };

  for (const entry of readdirSync(SERVICES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(SERVICES_DIR, entry.name, "service.json");
    if (!existsSync(manifestPath)) continue;
    try {
      services.push(...normalizeManifest(entry.name, JSON.parse(readFileSync(manifestPath, "utf8"))));
    } catch (err) {
      const message = `${entry.name}: ${err instanceof Error ? err.message : "invalid service.json"}`;
      errors.push(message);
      console.error(`[services] ${message}`);
    }
  }

  return { services, errors };
}

const STARTING_TIMEOUT_MS = 60_000;

function startingStatus(service: ServiceDef): ServiceStatus {
  const startedAt = pending.get(service.id);
  return startedAt !== undefined && Date.now() - startedAt < STARTING_TIMEOUT_MS ? "starting" : "stopped";
}

async function checkHealth(service: ServiceDef): Promise<ServiceStatus> {
  if (!service.healthUrl) return "unknown";
  try {
    const res = await fetch(service.healthUrl, { signal: AbortSignal.timeout(1500) });
    return res.ok ? "running" : startingStatus(service);
  } catch {
    const status = startingStatus(service);
    if (status === "stopped") pending.delete(service.id);
    return status;
  }
}

async function toManaged(service: ServiceDef): Promise<ManagedService> {
  return {
    id: service.id,
    group: service.group,
    name: service.name,
    description: service.description || "",
    cwd: service.cwd,
    healthUrl: service.healthUrl,
    status: await checkHealth(service),
  };
}

function run(command: string[], cwd: string, detach = false, allowFail = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: path.resolve(PROJECT_ROOT, cwd),
      detached: detach,
      stdio: detach ? "ignore" : ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    if (detach) {
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
      return;
    }
    child.on("exit", (code) => {
      if (code === 0 || allowFail) resolve();
      else reject(new Error(stderr.trim() || `exit ${code}`));
    });
  });
}

export async function listServices(): Promise<{ services: ManagedService[]; errors: string[] }> {
  const { services, errors } = readDefinitions();
  return { services: await Promise.all(services.map(toManaged)), errors };
}

export async function controlService(id: string, action: "start" | "restart" | "stop"): Promise<ManagedService> {
  const service = readDefinitions().services.find((item) => item.id === id);
  if (!service) throw new Error(`unknown service: ${id}`);

  console.log(`[services] ${action}: ${id} (${service.name})`);

  try {
    if (action === "stop" || action === "restart") await run(service.stop, PROJECT_ROOT, false, true);
    if (action === "start" || action === "restart") {
      pending.set(service.id, Date.now());
      await run(service.start, service.cwd, true);
    } else if (action === "stop") {
      pending.delete(service.id);
    }
  } catch (err) {
    console.error(`[services] ${action} ${id} failed:`, err);
    throw err;
  }

  const managed = await toManaged(service);
  if (managed.status === "running") pending.delete(service.id);
  console.log(`[services] ${action}: ${id} -> ${managed.status}`);
  return managed;
}
