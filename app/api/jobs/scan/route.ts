import { NextResponse } from "next/server";
import { authorize, equal, failure } from "@/lib/jobs/server";
import { runWorker } from "@/lib/jobs/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !equal(request.headers.get("authorization") || "", `Bearer ${secret}`)) return NextResponse.json({ error: "Yetkisiz zamanlayıcı." }, { status: 401 });
  try { return NextResponse.json(await runWorker("scheduler"), { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;
  try { return NextResponse.json(await runWorker("manual")); }
  catch (e) { return failure(e); }
}
