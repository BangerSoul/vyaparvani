import { NextRequest, NextResponse } from "next/server";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import {
  buildSystemPrompt,
  getIstTodayIso,
  parsedEntrySchema,
  parsedResponseSchema,
} from "@/lib/schema";
import {
  mergeDemoClarification,
  parseDemoUtterance,
  type ExistingDraftInput,
} from "@/lib/demo-parser";

export const runtime = "nodejs";

const MODEL_TIMEOUT_MS = 15000;
const KEY_HEADER = "x-openai-key";

const existingEntrySchema = parsedEntrySchema
  .partial()
  .extend({
    source: z.string().max(500).optional(),
  })
  .optional();

// Lets the UI show the "API key not set" banner. Never returns the key itself.
export async function GET() {
  return NextResponse.json({ hasServerKey: Boolean(process.env.OPENAI_API_KEY) });
}

export async function POST(req: NextRequest) {
  let utterance = "";
  let existingEntry: ExistingDraftInput | undefined;
  try {
    const body = await req.json();
    utterance = String(body?.utterance ?? "").slice(0, 500);
    if (body?.existingEntry !== undefined && body?.existingEntry !== null) {
      const parsedExisting = existingEntrySchema.safeParse(body.existingEntry);
      if (!parsedExisting.success) {
        return NextResponse.json(
          { error: "Invalid existingEntry", detail: parsedExisting.error.message },
          { status: 400 },
        );
      }
      existingEntry = parsedExisting.data;
    }
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
    try {
      const entries = existingEntry
        ? [mergeDemoClarification(utterance, existingEntry)]
        : parseDemoUtterance(utterance);
      console.log(JSON.stringify({
        mode: "demo",
        model: "rule-based",
        clarify: Boolean(existingEntry),
        latencyMs: Date.now() - started,
        utteranceLength: utterance.length,
        entries: entries.length,
      }));
      return NextResponse.json({ entries, mode: "demo" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: "Demo parsing failed", detail: msg },
        { status: 422 },
      );
    }
  }

  const openai = createOpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const systemPrompt = buildSystemPrompt(getIstTodayIso());
  const prompt = existingEntry
    ? `Existing draft entry JSON:\n${JSON.stringify(existingEntry)}\n\nUser clarification reply: "${utterance}"\nReturn a single merged entry in "entries" with missing fields patched in place.`
    : utterance;

  try {
    const { object, usage } = await withTimeout(
      generateObject({
        model: openai(model),
        schema: parsedResponseSchema,
        system: systemPrompt,
        prompt,
      }),
      MODEL_TIMEOUT_MS,
    );
    console.log(JSON.stringify({
      mode: "model",
      model,
      clarify: Boolean(existingEntry),
      latencyMs: Date.now() - started,
      promptTokens: usage?.promptTokens,
      completionTokens: usage?.completionTokens,
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
            system: systemPrompt,
            prompt,
          }),
          MODEL_TIMEOUT_MS,
        );
        console.log(JSON.stringify({
          mode: "model",
          model: model + " (retry)",
          latencyMs: Date.now() - started,
          promptTokens: usage?.promptTokens,
          completionTokens: usage?.completionTokens,
          entries: object.entries.length,
        }));
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
