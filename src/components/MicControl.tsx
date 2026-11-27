"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  listening: boolean;
  onStart: () => void;
  onStop: () => void;
  onResult: (finalText: string, interimText: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
};

export default function MicControl({ listening, onStart, onStop, onResult, onError, disabled }: Props) {
  const [supported, setSupported] = useState(true);
  const recRef = useRef<any>(null);

  // Latest callbacks without re-creating the recognition object on re-render.
  const cbRef = useRef({ onResult, onStop, onError });
  cbRef.current = { onResult, onStop, onError };

  useEffect(() => {
    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setSupported(false);
      return;
    }
    const rec = new SR();
    rec.lang = "hi-IN"; // Hinglish: Hindi locale, English words pass through
    rec.interimResults = true;
    rec.continuous = true;
    recRef.current = rec;
    rec.onresult = (e: any) => {
      let final = "";
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t + " ";
        else interim += t;
      }
      cbRef.current.onResult(final, interim);
    };
    rec.onend = () => cbRef.current.onStop();
    rec.onerror = (e: any) => {
      cbRef.current.onError(e?.error || "speech error");
      cbRef.current.onStop();
    };
    return () => {
      try { rec.stop(); } catch {}
    };
  }, []);

  function start() {
    const rec = recRef.current;
    if (!rec) return;
    try {
      rec.start();
      onStart();
    } catch {
      /* already started */
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={listening ? onStop : start}
        disabled={disabled || !supported}
        aria-pressed={listening}
        aria-label={listening ? "Stop recording" : "Start recording"}
        className={[
          "flex h-28 w-28 items-center justify-center rounded-full text-white transition-colors",
          listening ? "bg-saffronDeep mic-listening" : "bg-saffron hover:bg-saffronDeep",
          "disabled:opacity-40 disabled:cursor-not-allowed",
        ].join(" ")}
      >
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="22" />
        </svg>
      </button>
      <p className="text-sm text-inkSoft" role="status">
        {!supported
          ? "Is browser mein voice nahi chalta — neeche type karke bhi try kijiye."
          : listening
            ? "Sun raha hoon… bolte rahiye"
            : "Mic dabaake boliye"}
      </p>
    </div>
  );
}
