import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const KEY_HEADER = "x-openai-key";
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const TRANSCRIBE_TIMEOUT_MS = 20000;
const KIRANA_WHISPER_PROMPT =
  "Hinglish kirana store order and khata: chawal, atta, dal, chini, drib, kalawa, peti, darjan, udhaar, wasooli, Gupta store, Sharma kirana.";

function inferFilename(audio: Blob): string {
  const named = typeof (audio as File).name === "string" ? (audio as File).name.trim() : "";
  if (named && named !== "blob") return named;
  const mime = (audio.type || "").toLowerCase();
  if (mime.includes("mp4") || mime.includes("m4a")) return "recording.mp4";
  if (mime.includes("wav")) return "recording.wav";
  if (mime.includes("ogg")) return "recording.ogg";
  return "recording.webm";
}

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid multipart form data; 'audio' file required" },
      { status: 400 },
    );
  }

  const audio = formData.get("audio");
  if (!(audio instanceof Blob) || audio.size <= 0 || audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "Valid audio file (0 < size <= 10MB) is required" },
      { status: 400 },
    );
  }

  const headerKey = (req.headers.get(KEY_HEADER) || "").trim();
  const apiKey = (process.env.OPENAI_API_KEY || headerKey).trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "OpenAI API key required for Whisper audio transcription" },
      { status: 400 },
    );
  }

  const outbound = new FormData();
  outbound.append("file", audio, inferFilename(audio));
  outbound.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1");
  outbound.append("prompt", KIRANA_WHISPER_PROMPT);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSCRIBE_TIMEOUT_MS);

  try {
    const upstream = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: outbound,
      signal: controller.signal,
    });

    if (upstream.status === 401) {
      return NextResponse.json(
        { error: "OpenAI API key galat hai" },
        { status: 401 },
      );
    }
    if (upstream.status === 429) {
      return NextResponse.json(
        { error: "Whisper rate limit — thodi der baad try karein" },
        { status: 429 },
      );
    }
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: "Whisper transcription failed", detail: detail.slice(0, 300) },
        { status: 502 },
      );
    }

    const data = (await upstream.json()) as { text?: unknown };
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    return NextResponse.json({ text });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Whisper transcription request failed", detail: msg },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
