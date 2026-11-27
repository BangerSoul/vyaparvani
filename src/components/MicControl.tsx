"use client";

import { useEffect, useRef, useState } from "react";
import { WebSpeechAdapter, type SpeechInputAdapter } from "@/lib/speech-adapter";

type Props = {
  listening: boolean;
  onStart: () => void;
  onStop: () => void;
  onResult: (finalText: string, interimText: string) => void;
  onSessionEnd?: (finalTranscript: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
  adapter?: SpeechInputAdapter;
};

export default function MicControl({
  listening,
  onStart,
  onStop,
  onResult,
  onSessionEnd,
  onError,
  disabled,
  adapter,
}: Props) {
  const [supported, setSupported] = useState(true);
  const adapterRef = useRef<SpeechInputAdapter | null>(null);
  const finalTextRef = useRef("");
  const latestInterimRef = useRef("");
  const sessionActiveRef = useRef(false);

  // Latest callbacks without re-creating the recognition adapter on re-render.
  const cbRef = useRef({ onResult, onStop, onSessionEnd, onError });
  cbRef.current = { onResult, onStop, onSessionEnd, onError };

  useEffect(() => {
    const impl = adapter ?? new WebSpeechAdapter("hi-IN");
    adapterRef.current = impl;
    setSupported(impl.isSupported());
    return () => {
      sessionActiveRef.current = false;
      impl.stop();
    };
  }, [adapter]);

  function start() {
    const impl = adapterRef.current;
    if (!impl || !impl.isSupported()) return;
    finalTextRef.current = "";
    latestInterimRef.current = "";
    sessionActiveRef.current = true;
    onStart();
    impl.start({
      onResult: (finalChunk, interim) => {
        if (finalChunk) {
          const clean = finalChunk.trim();
          if (clean) {
            finalTextRef.current = finalTextRef.current
              ? `${finalTextRef.current.trimEnd()} ${clean} `
              : `${clean} `;
          }
        }
        latestInterimRef.current = interim || "";
        cbRef.current.onResult(finalTextRef.current, interim);
      },
      onEnd: () => {
        if (!sessionActiveRef.current) return;
        sessionActiveRef.current = false;
        const combined = `${finalTextRef.current} ${latestInterimRef.current}`
          .replace(/\s+/g, " ")
          .trim();
        cbRef.current.onStop();
        cbRef.current.onSessionEnd?.(combined);
      },
      onError: (msg) => {
        cbRef.current.onError(msg);
      },
    });
  }

  function stop() {
    adapterRef.current?.stop();
    cbRef.current.onStop();
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={listening ? stop : start}
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
