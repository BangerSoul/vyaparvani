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
