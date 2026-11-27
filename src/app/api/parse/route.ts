import { NextRequest, NextResponse } from "next/server";
import { createOpenAI } from "@ai-sdk/openai";
import { APICallError, RetryError, generateObject, type LanguageModel } from "ai";
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
const TOTAL_BUDGET_MS = 25000;
const MIN_RETRY_ATTEMPT_MS = 3000;
const MAX_429_RETRIES = 2;
const BASE_BACKOFF_MS = 600;
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

  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    const remainingBudget = TOTAL_BUDGET_MS - (Date.now() - started);
    if (remainingBudget <= 0) {
      return NextResponse.json(
        { error: "Model request timed out — thodi der baad dobara koshish kijiye." },
        { status: 504 },
      );
    }

    const timeoutMs = Math.max(1, Math.min(MODEL_TIMEOUT_MS, remainingBudget));
    try {
      const { object, usage } = await callModelOnce({
        model: openai(model),
        system: systemPrompt,
        prompt,
        timeoutMs,
        outerSignal: req.signal,
      });
      console.log(JSON.stringify({
        mode: "model",
        model: attempt > 0 ? `${model} (retry ${attempt})` : model,
        clarify: Boolean(existingEntry),
        latencyMs: Date.now() - started,
        promptTokens: usage?.promptTokens,
        completionTokens: usage?.completionTokens,
        entries: object.entries.length,
      }));
      return NextResponse.json({ entries: object.entries, mode: "model" });
    } catch (err: unknown) {
      if (isAbortError(err)) {
        return NextResponse.json(
          { error: "Model request timed out — thodi der baad dobara koshish kijiye." },
          { status: 504 },
        );
      }

      const { statusCode, message, responseBody } = extractErrorInfo(err);
      const combinedText = `${message}\n${responseBody}`;

      if (
        statusCode === 401 ||
        /invalid_api_key|incorrect api key|unauthorized/i.test(combinedText)
      ) {
        return NextResponse.json(
          {
            error:
              "OpenAI API key galat hai — sahi key daaliye ya key hatakar Demo parser chalayein.",
          },
          { status: 401 },
        );
      }

      if (
        statusCode === 429 ||
        /rate.?limit|too many requests|\b429\b/i.test(combinedText)
      ) {
        if (/insufficient_quota/i.test(combinedText) || attempt >= MAX_429_RETRIES) {
          return NextResponse.json(
            { error: "OpenAI rate limit — thodi der baad try karein" },
            { status: 429 },
          );
        }

        const backoffMs = BASE_BACKOFF_MS * 2 ** attempt;
        const remainingAfterWait = TOTAL_BUDGET_MS - (Date.now() - started) - backoffMs;
        if (remainingAfterWait < MIN_RETRY_ATTEMPT_MS) {
          return NextResponse.json(
            { error: "OpenAI rate limit — thodi der baad try karein" },
            { status: 429 },
          );
        }

        try {
          await sleepWithAbort(backoffMs, req.signal);
        } catch {
          return NextResponse.json(
            { error: "Model request timed out — thodi der baad dobara koshish kijiye." },
            { status: 504 },
          );
        }
        continue;
      }

      return NextResponse.json(
        { error: "Parsing failed", detail: message },
        { status: 502 },
      );
    }
  }

  return NextResponse.json(
    { error: "OpenAI rate limit — thodi der baad try karein" },
    { status: 429 },
  );
}

async function callModelOnce(opts: {
  model: LanguageModel;
  system: string;
  prompt: string;
  timeoutMs: number;
  outerSignal?: AbortSignal;
}) {
  const { model, system, prompt, timeoutMs, outerSignal } = opts;
  if (outerSignal?.aborted) {
    const abortErr = new Error("Request aborted");
    abortErr.name = "AbortError";
    throw abortErr;
  }

  const controller = new AbortController();
  let timedOut = false;
  const onOuterAbort = () => controller.abort();
  outerSignal?.addEventListener("abort", onOuterAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await generateObject({
      model,
      schema: parsedResponseSchema,
      system,
      prompt,
      maxRetries: 0,
      abortSignal: controller.signal,
    });
  } catch (err: unknown) {
    if (timedOut && !isAbortError(err)) {
      const timeoutErr = new Error(`Timed out after ${timeoutMs}ms`);
      timeoutErr.name = "AbortError";
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onOuterAbort);
  }
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const record = err as { name?: unknown; cause?: { name?: unknown } };
  return (
    record.name === "AbortError" ||
    record.name === "TimeoutError" ||
    record.cause?.name === "AbortError" ||
    record.cause?.name === "TimeoutError"
  );
}

function extractErrorInfo(err: unknown): {
  statusCode?: number;
  message: string;
  responseBody: string;
} {
  const target = RetryError.isInstance(err) && err.lastError ? err.lastError : err;
  if (APICallError.isInstance(target)) {
    return {
      statusCode: target.statusCode,
      message: target.message,
      responseBody: target.responseBody ?? "",
    };
  }
  const obj = target as {
    statusCode?: unknown;
    status?: unknown;
    message?: unknown;
    responseBody?: unknown;
    cause?: { statusCode?: unknown; status?: unknown };
  } | null;
  const rawStatus =
    obj?.statusCode ?? obj?.status ?? obj?.cause?.statusCode ?? obj?.cause?.status;
  const statusCode = typeof rawStatus === "number" ? rawStatus : undefined;
  const message =
    target instanceof Error
      ? target.message
      : typeof obj?.message === "string"
        ? obj.message
        : String(target);
  const responseBody = typeof obj?.responseBody === "string" ? obj.responseBody : "";
  return { statusCode, message, responseBody };
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    const abortErr = new Error("Aborted during backoff");
    abortErr.name = "AbortError";
    return Promise.reject(abortErr);
  }
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      const abortErr = new Error("Aborted during backoff");
      abortErr.name = "AbortError";
      reject(abortErr);
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
