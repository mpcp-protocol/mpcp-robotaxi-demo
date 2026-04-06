import { NextRequest, NextResponse } from "next/server";
import { exec, spawn } from "node:child_process";
import { resolve } from "node:path";
import { checkPaHealth, invalidatePaCache, setBroadcastFn } from "@/lib/demo-controls";
import { broadcast } from "@/lib/events";

setBroadcastFn(broadcast as (type: string, msg: string) => void);

const PA_DIR = resolve(process.cwd(), "../../mpcp-policy-authority");

function run(cmd: string): Promise<string> {
  return new Promise((resolve) => {
    const child = exec(cmd, { timeout: 2_000 }, (err, stdout) => {
      resolve(err ? "" : stdout.trim());
    });
    child.unref();
  });
}

async function killListenersOnPort(port: number): Promise<boolean> {
  // -sTCP:LISTEN ensures we only kill the SERVER on this port,
  // not other processes (like ourselves) that have client connections to it.
  const out = await run(`lsof -ti :${port} -sTCP:LISTEN 2>/dev/null`);
  if (!out) return false;
  const pids = out.split("\n").map(Number).filter(Boolean);
  for (const pid of pids) {
    try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
  }
  return pids.length > 0;
}

async function isPortFree(port: number): Promise<boolean> {
  const out = await run(`lsof -ti :${port} -sTCP:LISTEN 2>/dev/null`);
  return !out;
}

export async function GET() {
  const running = await checkPaHealth();
  return NextResponse.json({ running });
}

export async function POST(req: NextRequest) {
  const { action }: { action: "start" | "stop" } = await req.json();

  if (action === "stop") {
    await killListenersOnPort(3000);
    invalidatePaCache();
    broadcast("infra:pa_stopped", "Policy Authority stopped");
    return NextResponse.json({ ok: true, running: false });
  }

  if (action === "start") {
    if (!(await isPortFree(3000))) {
      return NextResponse.json({ ok: true, running: true, message: "PA already running" });
    }

    spawn("npm", ["run", "dev"], {
      cwd: PA_DIR,
      stdio: "ignore",
      detached: true,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: "development",
        FORCE_COLOR: "0",
      },
    }).unref();

    invalidatePaCache();
    return NextResponse.json({ ok: true, running: false, message: "PA starting…" });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
