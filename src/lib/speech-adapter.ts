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
      if (this.rec !== rec) return;
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
  private uploadController: AbortController | null = null;
  private cancelled = false;
  private recordingId = 0;

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

  private stopStream(stream: MediaStream | null) {
    if (!stream) return;
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // ignore track stop errors
      }
    }
    if (this.stream === stream) {
      this.stream = null;
    }
  }

  private stopTracks() {
    this.stopStream(this.stream);
  }

  start(callbacks: SpeechInputCallbacks): void {
    if (!this.isSupported()) {
      callbacks.onError?.("whisper-recording-unsupported");
      callbacks.onEnd?.();
      return;
    }

    const sessionId = ++this.recordingId;
    if (this.uploadController) {
      this.uploadController.abort();
      this.uploadController = null;
    }

    if (this.recorder && this.recorder.state !== "inactive") {
      const prevRecorder = this.recorder;
      prevRecorder.ondataavailable = null;
      prevRecorder.onerror = null;
      prevRecorder.onstop = null;
      try {
        prevRecorder.stop();
      } catch {
        // ignore cleanup error
      }
    }
    this.stopTracks();
    this.recorder = null;
    this.cancelled = false;

    void this.beginRecording(callbacks, sessionId);
  }

  private async beginRecording(
    callbacks: SpeechInputCallbacks,
    sessionId: number,
  ): Promise<void> {
    let localStream: MediaStream | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStream = stream;
      if (sessionId !== this.recordingId) {
        this.stopStream(stream);
        return;
      }
      if (this.cancelled) {
        this.stopStream(stream);
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
        if (sessionId !== this.recordingId) return;
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onerror = () => {
        this.stopStream(stream);
        if (this.recorder === recorder) this.recorder = null;
        if (sessionId !== this.recordingId) return;
        callbacks.onError?.("audio-recording-error");
        callbacks.onEnd?.();
      };

      recorder.onstop = async () => {
        const activeMime = recorder.mimeType || chosenMime || "audio/webm";
        this.stopStream(stream);
        if (this.recorder === recorder) this.recorder = null;

        if (sessionId !== this.recordingId) {
          return;
        }
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

        const controller = new AbortController();
        this.uploadController = controller;
        try {
          const form = new FormData();
          form.append("audio", blob, `recording.${ext}`);
          const apiKey = this.getApiKey?.().trim() || "";
          const res = await fetch(this.endpoint, {
            method: "POST",
            headers: apiKey ? { "x-openai-key": apiKey } : undefined,
            body: form,
            signal: controller.signal,
          });
          if (sessionId !== this.recordingId || this.cancelled) return;
          const payload = (await res.json().catch(() => ({}))) as {
            text?: string;
            error?: string;
          };
          if (sessionId !== this.recordingId || this.cancelled) return;
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
          if (sessionId !== this.recordingId || this.cancelled) return;
          callbacks.onError?.(
            err instanceof Error ? err.message : "Whisper upload failed",
          );
        } finally {
          if (this.uploadController === controller) {
            this.uploadController = null;
          }
          if (sessionId === this.recordingId) {
            callbacks.onEnd?.();
          }
        }
      };

      recorder.start();
      if (sessionId === this.recordingId) {
        callbacks.onInterim?.("Audio record ho raha hai…");
      }
    } catch (err: unknown) {
      this.stopStream(localStream);
      this.recorder = null;
      if (sessionId !== this.recordingId) return;
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

export const DEMO_VOICE_PHRASES = [
  "3 packet surf Gupta store ko bhej do aur unka 200 udhaar tha",
  "5 kg chawal Verma store ko bhej do",
  "Sharma kirana se 300 wasooli",
  "10 kg chawal stock mein add karo",
] as const;

export class DemoVoiceAdapter implements SpeechInputAdapter {
  private getPhrase: () => string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private words: string[] = [];
  private cursor = 0;
  private callbacks: SpeechInputCallbacks | null = null;

  constructor(getPhrase: () => string) {
    this.getPhrase = getPhrase;
  }

  isSupported(): boolean {
    return true;
  }

  start(callbacks: SpeechInputCallbacks): void {
    this.clearTimer();
    const phrase = (this.getPhrase() || DEMO_VOICE_PHRASES[0]).trim();
    this.words = phrase.split(/\s+/).filter(Boolean);
    this.cursor = 0;
    this.active = true;
    this.callbacks = callbacks;

    const tick = () => {
      if (!this.active || !this.callbacks) return;
      if (this.cursor < this.words.length) {
        this.cursor += 1;
        const spokenSoFar = this.words.slice(0, this.cursor).join(" ");
        this.callbacks.onInterim?.(spokenSoFar);
        this.callbacks.onResult?.("", spokenSoFar);
        this.timer = setTimeout(tick, 170);
        return;
      }
      const full = this.words.join(" ");
      const cb = this.callbacks;
      this.active = false;
      this.callbacks = null;
      this.timer = null;
      cb.onFinal?.(full);
      cb.onResult?.(full, "");
      cb.onEnd?.();
    };

    this.timer = setTimeout(tick, 220);
  }

  stop(): void {
    this.clearTimer();
    if (!this.active || !this.callbacks) return;
    const spoken = this.words.slice(0, Math.max(1, this.cursor)).join(" ").trim();
    const cb = this.callbacks;
    this.active = false;
    this.callbacks = null;
    if (spoken) {
      cb.onFinal?.(spoken);
      cb.onResult?.(spoken, "");
    }
    cb.onEnd?.();
  }

  private clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
