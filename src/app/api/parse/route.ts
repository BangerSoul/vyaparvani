import { NextRequest, NextResponse } from "next/server";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import { parsedEntrySchema, SYSTEM_PROMPT } from "@/lib/schema";
import { parseDemo } from "@/lib/demo-parser";

export const runtime = "nodejs";

const MODEL_TIMEOUT_MS = 15000;

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

  const apiKey = process.env.OPENAI_API_KEY;
  const started = Date.now();

  if (!apiKey) {
    // Demo mode: local rule-based parser, clearly not the real model.
    const parsed = parseDemo(utterance);
    console.log(JSON.stringify({
      mode: "demo", model: "rule-based", latencyMs: Date.now() - started,
      utteranceLength: utterance.length,
    }));
    return NextResponse.json({ ...parsed, mode: "demo" });
  }

  const openai = createOpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  try {
    const { object, usage } = await withTimeout(
      generateObject({
        model: openai(model),
        schema: parsedEntrySchema,
        system: SYSTEM_PROMPT,
        prompt: utterance,
      }),
      MODEL_TIMEOUT_MS,
    );
    console.log(JSON.stringify({
      mode: "model", model, latencyMs: Date.now() - started,
      promptTokens: usage?.promptTokens, completionTokens: usage?.completionTokens,
    }));
    return NextResponse.json({ ...object, mode: "model" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/rate.?limit|429/i.test(msg)) {
      // one retry on rate limit
      try {
        const { object, usage } = await withTimeout(
          generateObject({
            model: openai(model),
            schema: parsedEntrySchema,
            system: SYSTEM_PROMPT,
            prompt: utterance,
          }),
          MODEL_TIMEOUT_MS,
        );
        console.log(JSON.stringify({ mode: "model", model: model + " (retry)", latencyMs: Date.now() - started, promptTokens: usage?.promptTokens, completionTokens: usage?.completionTokens }));
        return NextResponse.json({ ...object, mode: "model" });
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
