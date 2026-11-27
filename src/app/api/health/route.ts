import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const hasServerKey = Boolean(process.env.OPENAI_API_KEY?.trim());
  return NextResponse.json(
    {
      ok: true,
      status: "healthy",
      mode: hasServerKey ? "model" : "demo",
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
