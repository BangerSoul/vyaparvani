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
  autoStartKey?: number;
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
  autoStartKey = 0,
}: Props) {
  const [supported, setSupported] = useState(true);
  const [transcribing, setTranscribing] = useState(false);
  const adapterRef = useRef<SpeechInputAdapter | null>(null);
  const finalTextRef = useRef("");
  const latestInterimRef = useRef("");
  const sessionActiveRef = useRef(false);
  const sessionIdRef = useRef(0);
  const lastAutoStartKeyRef = useRef(0);

  // Latest callbacks without re-creating the recognition adapter on re-render.
  const cbRef = useRef({ onResult, onStop, onSessionEnd, onError, onStart });
  cbRef.current = { onResult, onStop, onSessionEnd, onError, onStart };

  function beginSession(impl: SpeechInputAdapter) {
    if (!impl || !impl.isSupported()) return;
    const sid = ++sessionIdRef.current;
    finalTextRef.current = "";
    latestInterimRef.current = "";
    sessionActiveRef.current = true;
    setTranscribing(false);
    cbRef.current.onStart();
    impl.start({
      onInterim: (interim) => {
        if (sid !== sessionIdRef.current) return;
        cbRef.current.onResult(finalTextRef.current, interim);
      },
      onResult: (finalChunk, interim) => {
        if (sid !== sessionIdRef.current) return;
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
        if (sid !== sessionIdRef.current || !sessionActiveRef.current) return;
        sessionActiveRef.current = false;
        setTranscribing(false);
        const combined = `${finalTextRef.current} ${latestInterimRef.current}`
          .replace(/\s+/g, " ")
          .trim();
        cbRef.current.onStop();
        cbRef.current.onSessionEnd?.(combined);
      },
      onError: (msg) => {
        if (sid !== sessionIdRef.current) return;
        setTranscribing(false);
        cbRef.current.onError(msg);
      },
    });
  }

  useEffect(() => {
    const impl = adapter ?? new WebSpeechAdapter("hi-IN");
    adapterRef.current = impl;
    setSupported(impl.isSupported());
    if (autoStartKey > 0 && autoStartKey !== lastAutoStartKeyRef.current) {
      lastAutoStartKeyRef.current = autoStartKey;
      beginSession(impl);
    }
    return () => {
      sessionIdRef.current += 1;
      sessionActiveRef.current = false;
      setTranscribing(false);
      impl.stop();
    };
  }, [adapter, autoStartKey]);

  function start() {
    if (transcribing) return;
    const impl = adapterRef.current;
    if (!impl || !impl.isSupported()) return;
    beginSession(impl);
  }

  function stop() {
    if (sessionActiveRef.current) {
      setTranscribing(true);
    }
    adapterRef.current?.stop();
    cbRef.current.onStop();
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={listening ? stop : start}
        disabled={disabled || !supported || transcribing}
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
          : transcribing
            ? "Audio samajh raha hoon…"
            : listening
              ? "Sun raha hoon… bolte rahiye"
              : "Mic dabaake boliye"}
      </p>
    </div>
  );
}
