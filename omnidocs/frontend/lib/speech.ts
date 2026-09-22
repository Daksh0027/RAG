"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Strips common Markdown syntax so text-to-speech doesn't read out literal
 * asterisks, hashes, backticks, etc.
 */
function stripMarkdownForSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " code block ") // fenced code blocks
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links -> visible text only
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // bold
    .replace(/(\*|_)(.*?)\1/g, "$2") // italics
    .replace(/^\s*>\s?/gm, "") // blockquotes
    .replace(/^\s*[-*+]\s+/gm, "") // bullet list markers
    .replace(/^\s*\d+\.\s+/gm, "") // numbered list markers
    .replace(/-{3,}/g, "") // horizontal rules
    .replace(/\n{2,}/g, ". ") // paragraph breaks -> a pause
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Text-to-speech for assistant answers, backed by the browser's built-in
 * Web Speech API (no backend/API cost). Tracks which message id (if any)
 * is currently being read aloud so a single "speak" button can toggle
 * between play/stop per message.
 */
export function useSpeech() {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    setIsSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakingId(null);
  }, []);

  const speak = useCallback((id: string, text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    // Clicking the currently-speaking message's button again stops it.
    if (speakingId === id) {
      stop();
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(stripMarkdownForSpeech(text));
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onend = () => setSpeakingId((current) => (current === id ? null : current));
    utterance.onerror = () => setSpeakingId((current) => (current === id ? null : current));
    setSpeakingId(id);
    window.speechSynthesis.speak(utterance);
  }, [speakingId, stop]);

  return { speak, stop, speakingId, isSupported };
}
