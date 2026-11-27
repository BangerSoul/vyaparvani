import { NextRequest, NextResponse } from "next/server";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { parsedEntrySchema, parsedResponseSchema, SYSTEM_PROMPT } from "@/lib/schema";
import { parseDemoUtterance } from "@/lib/demo-parser";

export const runtime = "nodejs";

const MODEL_TIMEOUT_MS = 15000;
const KEY_HEADER = "x-openai-key";

// Lets the UI show the "API key not set" banner. Never returns the key itself.
export async function GET() {
  return NextResponse.json({ hasServerKey: Boolean(process.env.OPENAI_API_KEY) });
}

export async function POST(req: NextRequest) {
  let utterance = "";
  try {
    const body = await req.json();
    utterance = String(body?.utterance ?? "").slice(0, 500);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!utterance.trim()) {
    return NextResponse.json({ error: "utterance is required" }, { status: 400 });
  }

  // Server env key first; otherwise a per-request key the user typed into the
  // app (kept in their browser session, never logged or persisted here).
  const headerKey = (req.headers.get(KEY_HEADER) || "").trim();
  const apiKey = process.env.OPENAI_API_KEY || headerKey;
  const started = Date.now();

  if (!apiKey) {
    // Demo mode: local rule-based parser, clearly not the real model.
    const entries = parseDemoUtterance(utterance);
    console.log(JSON.stringify({
      mode: "demo", model: "rule-based", latencyMs: Date.now() - started,
      utteranceLength: utterance.length, entries: entries.length,
    }));
    return NextResponse.json({ entries, mode: "demo" });
  }

  const openai = createOpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  try {
    const { object, usage } = await withTimeout(
      generateObject({
        model: openai(model),
        schema: parsedResponseSchema,
        system: SYSTEM_PROMPT,
        prompt: utterance,
      }),
      MODEL_TIMEOUT_MS,
    );
    console.log(JSON.stringify({
      mode: "model", model, latencyMs: Date.now() - started,
      promptTokens: usage?.promptTokens, completionTokens: usage?.completionTokens,
      entries: object.entries.length,
    }));
    return NextResponse.json({ entries: object.entries, mode: "model" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/rate.?limit|429/i.test(msg)) {
      // one retry on rate limit
      try {
        const { object, usage } = await withTimeout(
          generateObject({
            model: openai(model),
            schema: parsedResponseSchema,
            system: SYSTEM_PROMPT,
            prompt: utterance,
          }),
          MODEL_TIMEOUT_MS,
        );
        console.log(JSON.stringify({ mode: "model", model: model + " (retry)", latencyMs: Date.now() - started, promptTokens: usage?.promptTokens, completionTokens: usage?.completionTokens, entries: object.entries.length }));
        return NextResponse.json({ entries: object.entries, mode: "model" });
      } catch (retryErr: unknown) {
        return NextResponse.json(
          { error: "Rate limited and retry failed", detail: retryErr instanceof Error ? retryErr.message : String(retryErr) },
          { status: 429 },
        );
      }
    }
    return NextResponse.json(
      { error: "Parsing failed", detail: msg },
      { status: 502 },
    );
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`Timed out after ${ms}ms`)), ms)),
  ]);
}
