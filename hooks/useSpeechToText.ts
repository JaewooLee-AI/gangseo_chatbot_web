"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface SpeechRecognitionOptions {
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
}

export function useSpeechToText(options: SpeechRecognitionOptions = {}) {
  const { lang = "ko-KR", continuous = true, interimResults = true } = options;
  const [isListening, setIsListening] = useState<boolean>(false);
  const [transcript, setTranscript] = useState<string>("");
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // SpeechRecognition or webkitSpeechRecognition feature detection
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      try {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = continuous;
        recognitionRef.current.interimResults = interimResults;
        recognitionRef.current.lang = lang;

        recognitionRef.current.onresult = (event: any) => {
          let currentTranscript = "";
          for (let i = 0; i < event.results.length; i++) {
            currentTranscript += event.results[i][0].transcript;
          }
          setTranscript(currentTranscript);
        };

        recognitionRef.current.onerror = (event: any) => {
          console.error("STT Error:", event.error);
          setIsListening(false);
        };

        recognitionRef.current.onend = () => {
          setIsListening(false);
        };
      } catch (err) {
        console.warn("Failed to initialize SpeechRecognition:", err);
      }
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // ignore
        }
      }
    };
  }, [lang, continuous, interimResults]);

  const startListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        setTranscript("");
        setIsListening(true);
        recognitionRef.current.start();
      } catch (err) {
        console.error("Error starting speech recognition:", err);
        setIsListening(false);
      }
    } else {
      alert("현재 사용 중인 브라우저에서는 음성 인식(Web Speech API)을 지원하지 않습니다.");
    }
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        setIsListening(false);
        recognitionRef.current.stop();
      } catch (err) {
        console.error("Error stopping speech recognition:", err);
      }
    }
  }, []);

  return { isListening, transcript, startListening, stopListening, setTranscript };
}
