export type SpeechInputCallbacks = {
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onResult?: (finalChunk: string, interimText: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
};

export interface SpeechInputAdapter {
  isSupported(): boolean;
  start(callbacks: SpeechInputCallbacks): void;
  stop(): void;
}

type SpeechRecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechRecognitionResultEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

type SpeechRecognitionResultEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

export class WebSpeechAdapter implements SpeechInputAdapter {
  private rec: InstanceType<SpeechRecognitionCtor> | null = null;
  private lang: string;

  constructor(lang = "hi-IN") {
    this.lang = lang;
  }

  isSupported(): boolean {
    return getSpeechRecognitionCtor() !== null;
  }

  start(callbacks: SpeechInputCallbacks): void {
    const SR = getSpeechRecognitionCtor();
    if (!SR) {
      callbacks.onError?.("speech-recognition-unsupported");
      callbacks.onEnd?.();
      return;
    }

    if (this.rec) {
      const prev = this.rec;
      this.rec = null;
      prev.onresult = null;
      prev.onend = null;
      prev.onerror = null;
      try {
        prev.abort ? prev.abort() : prev.stop();
      } catch {
        // ignore cleanup failure
      }
    }

    const rec = new SR();
    rec.lang = this.lang;
    rec.interimResults = true;
    rec.continuous = true;
    this.rec = rec;

    rec.onresult = (e: SpeechRecognitionResultEventLike) => {
      let finalChunk = "";
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const t = result?.[0]?.transcript ?? "";
        if (!t) continue;
        if (result.isFinal) {
          finalChunk += t + " ";
        } else {
          interim += t;
        }
      }
      if (finalChunk.trim()) callbacks.onFinal?.(finalChunk.trim());
      if (interim) callbacks.onInterim?.(interim);
      callbacks.onResult?.(finalChunk, interim);
    };

    rec.onend = () => {
      if (this.rec === rec) {
        this.rec = null;
        callbacks.onEnd?.();
      }
    };

    rec.onerror = (e: { error?: string }) => {
      const msg = e?.error || "speech error";
      callbacks.onError?.(msg);
      if (this.rec === rec) {
        this.rec = null;
        callbacks.onEnd?.();
      }
    };

    try {
      rec.start();
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : "";
      if (name !== "InvalidStateError") {
        this.rec = null;
        callbacks.onError?.(err instanceof Error ? err.message : "speech start failed");
        callbacks.onEnd?.();
      }
    }
  }

  stop(): void {
    const rec = this.rec;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      // ignore if already stopped
    }
  }
}

export type WhisperAdapterOptions = {
  getApiKey?: () => string;
  endpoint?: string;
  mimeType?: string;
};

function pickRecorderMimeType(preferred?: string): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    preferred,
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ].filter((v): v is string => Boolean(v));
  for (const mime of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      // ignore probe failure
    }
  }
  return undefined;
}

export class WhisperApiAdapter implements SpeechInputAdapter {
  private getApiKey?: () => string;
  private endpoint: string;
  private preferredMimeType?: string;
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private cancelled = false;

  constructor(options: WhisperAdapterOptions = {}) {
    this.getApiKey = options.getApiKey;
    this.endpoint = options.endpoint ?? "/api/transcribe";
    this.preferredMimeType = options.mimeType;
  }

  isSupported(): boolean {
    return (
      typeof window !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== "undefined"
    );
  }

  private stopTracks() {
    if (!this.stream) return;
    for (const track of this.stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // ignore track stop errors
      }
    }
    this.stream = null;
  }

  start(callbacks: SpeechInputCallbacks): void {
    if (!this.isSupported()) {
      callbacks.onError?.("whisper-recording-unsupported");
      callbacks.onEnd?.();
      return;
    }

    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch {
        // ignore cleanup error
      }
    }
    this.stopTracks();
    this.recorder = null;
    this.cancelled = false;

    void this.beginRecording(callbacks);
  }

  private async beginRecording(callbacks: SpeechInputCallbacks): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this.cancelled) {
        for (const t of stream.getTracks()) t.stop();
        callbacks.onEnd?.();
        return;
      }
      this.stream = stream;

      const chosenMime = pickRecorderMimeType(this.preferredMimeType);
      const recorder = chosenMime
        ? new MediaRecorder(stream, { mimeType: chosenMime })
        : new MediaRecorder(stream);
      this.recorder = recorder;

      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onerror = () => {
        this.stopTracks();
        this.recorder = null;
        callbacks.onError?.("audio-recording-error");
        callbacks.onEnd?.();
      };

      recorder.onstop = async () => {
        const activeMime = recorder.mimeType || chosenMime || "audio/webm";
        this.stopTracks();
        this.recorder = null;

        if (this.cancelled || chunks.length === 0) {
          callbacks.onEnd?.();
          return;
        }

        const ext = activeMime.includes("mp4")
          ? "mp4"
          : activeMime.includes("wav")
            ? "wav"
            : "webm";
        const blob = new Blob(chunks, { type: activeMime });
        callbacks.onInterim?.("Whisper se audio samajh raha hoon…");

        try {
          const form = new FormData();
          form.append("audio", blob, `recording.${ext}`);
          const apiKey = this.getApiKey?.().trim() || "";
          const res = await fetch(this.endpoint, {
            method: "POST",
            headers: apiKey ? { "x-openai-key": apiKey } : undefined,
            body: form,
          });
          const payload = (await res.json().catch(() => ({}))) as {
            text?: string;
            error?: string;
          };
          if (!res.ok) {
            callbacks.onError?.(payload.error || `Whisper error (${res.status})`);
            return;
          }
          const text = typeof payload.text === "string" ? payload.text.trim() : "";
          if (text) {
            callbacks.onFinal?.(text);
            callbacks.onResult?.(text, "");
          }
        } catch (err: unknown) {
          callbacks.onError?.(
            err instanceof Error ? err.message : "Whisper upload failed",
          );
        } finally {
          callbacks.onEnd?.();
        }
      };

      recorder.start();
      callbacks.onInterim?.("Audio record ho raha hai…");
    } catch (err: unknown) {
      this.stopTracks();
      this.recorder = null;
      const name = err instanceof Error ? err.name : "";
      callbacks.onError?.(
        name === "NotAllowedError"
          ? "not-allowed"
          : err instanceof Error
            ? err.message
            : "audio-capture-failed",
      );
      callbacks.onEnd?.();
    }
  }

  stop(): void {
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
        return;
      } catch {
        // fall through to cleanup
      }
    }
    this.cancelled = true;
    this.stopTracks();
  }
}
