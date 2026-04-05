import { NextRequest, NextResponse } from "next/server";
import { execSync, spawn } from "node:child_process";
import { resolve } from "node:path";
import { checkPaHealth, invalidatePaCache } from "@/lib/demo-controls";
import { broadcast } from "@/lib/events";

const PA_DIR = resolve(process.cwd(), "../../mpcp-policy-authority");

function findPaPid(): number | null {
  try {
    const out = execSync("lsof -ti :3000 2>/dev/null", { encoding: "utf-8" }).trim();
    const pids = out.split("\n").map(Number).filter(Boolean);
    return pids[0] ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  const running = await checkPaHealth();
  return NextResponse.json({ running });
}

export async function POST(req: NextRequest) {
  const { action }: { action: "start" | "stop" } = await req.json();

  if (action === "stop") {
    const pid = findPaPid();
    if (!pid) {
      return NextResponse.json({ ok: true, running: false, message: "PA was not running" });
    }
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
    }
    invalidatePaCache();
    broadcast("infra:pa_stopped", "Policy Authority stopped (process killed)");
    return NextResponse.json({ ok: true, running: false });
  }

  if (action === "start") {
    const existing = findPaPid();
    if (existing) {
      return NextResponse.json({ ok: true, running: true, message: "PA already running" });
    }

    const child = spawn("npm", ["run", "dev"], {
      cwd: PA_DIR,
      stdio: "ignore",
      detached: true,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    child.unref();

    // Poll until healthy (up to 15s)
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      invalidatePaCache();
      if (await checkPaHealth()) {
        broadcast("infra:pa_started", "Policy Authority started and healthy");
        return NextResponse.json({ ok: true, running: true });
      }
    }

    return NextResponse.json({ ok: false, running: false, message: "PA started but health check timed out" });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
