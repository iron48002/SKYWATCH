import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Router, type IRouter } from "express";
import {
  GetSkySnapshotQueryParams,
  GetSkySnapshotResponse,
} from "@workspace/api-zod";

type SkywatcherFailure = {
  error?: string;
  kind?: string;
};

class SkywatcherProcessError extends Error {
  constructor(
    message: string,
    readonly kind: string,
    readonly stderr = "",
  ) {
    super(message);
    this.name = "SkywatcherProcessError";
  }
}

const router: IRouter = Router();
const sourcePath = join(
  "attached_assets",
  "Pasted--usr-bin-env-python3-Skywatcher-a-terminal-planetarium-_1792144238791.txt",
);
const moduleDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = [
  process.cwd(),
  resolve(process.cwd(), "../.."),
  resolve(moduleDir, ".."),
  resolve(moduleDir, "../../.."),
].find((candidate) => existsSync(join(candidate, sourcePath))) ?? process.cwd();
const pythonPath = resolve(workspaceRoot, ".pythonlibs/bin/python");
const pythonAdapterPath = resolve(
  workspaceRoot,
  "artifacts/api-server/python/skywatcher_api.py",
);
const snapshotCache = new Map<
  string,
  { expiresAt: number; value: Promise<unknown> }
>();
const CACHE_TTL_MS = 30_000;
const MAX_OUTPUT_CHARS = 8_000_000;
const CALCULATION_TIMEOUT_MS = 180_000;

function calculateSnapshot(location: string): Promise<unknown> {
  const key = location.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const now = Date.now();
  const cached = snapshotCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;

  const value = new Promise<unknown>((resolvePromise, rejectPromise) => {
    const child = spawn(pythonPath, [pythonAdapterPath], {
      cwd: workspaceRoot,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      fail(
        new SkywatcherProcessError(
          "The astronomy calculation took too long. Try refreshing in a moment.",
          "timeout",
        ),
      );
    }, CALCULATION_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT_CHARS) {
        child.kill("SIGTERM");
        fail(new SkywatcherProcessError("Skywatcher returned an oversized response.", "output"));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-20_000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      fail(
        new SkywatcherProcessError(
          "The Skywatcher Python runtime could not be started.",
          "runtime",
          error.message,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;

      let payload: unknown;
      try {
        payload = JSON.parse(stdout.trim());
      } catch {
        fail(
          new SkywatcherProcessError(
            "Skywatcher returned an unreadable response.",
            "response",
            stderr,
          ),
        );
        return;
      }

      if (code === 0) {
        settled = true;
        resolvePromise(payload);
        return;
      }

      const failure = payload as SkywatcherFailure;
      fail(
        new SkywatcherProcessError(
          failure.error ?? "The astronomy calculation failed.",
          failure.kind ?? "astronomy",
          stderr,
        ),
      );
    });
    child.stdin.on("error", () => {
      // A closed child is handled by its error/close event above.
    });
    child.stdin.end(JSON.stringify({ location }), "utf8");
  });

  snapshotCache.set(key, { expiresAt: now + CACHE_TTL_MS, value });
  if (snapshotCache.size > 24) {
    const oldestKey = snapshotCache.keys().next().value;
    if (oldestKey) snapshotCache.delete(oldestKey);
  }
  void value.catch(() => {
    snapshotCache.delete(key);
  });
  return value;
}

router.get("/skywatcher/sky", async (req, res): Promise<void> => {
  const parsed = GetSkySnapshotQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a city name or coordinates to load the sky." });
    return;
  }

  try {
    const result = await calculateSnapshot(parsed.data.location);
    res.json(GetSkySnapshotResponse.parse(result));
  } catch (error) {
    if (error instanceof SkywatcherProcessError) {
      if (error.kind === "location" || error.kind === "input") {
        req.log.warn({ error: error.message }, "Invalid Skywatcher location");
        res.status(400).json({ error: error.message });
        return;
      }
      req.log.error(
        { error: error.message, stderr: error.stderr || undefined },
        "Skywatcher calculation failed",
      );
      res.status(503).json({ error: error.message });
      return;
    }

    req.log.error({ err: error }, "Skywatcher response validation failed");
    res.status(503).json({ error: "Skywatcher could not return current sky data." });
  }
});

export default router;
