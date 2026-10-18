"use client";

import { useEffect, useState } from "react";

const REEL: { source: string; page: number; snippet: string }[] = [
  { source: "Lease_A.pdf", page: 7, snippet: "30 days' written notice" },
  { source: "Lease_B.pdf", page: 5, snippet: "60 days' written notice" },
  { source: "Lease_C.pdf", page: 12, snippet: "90 days' written notice" },
  { source: "Lease_A.pdf", page: 9, snippet: "subletting with landlord consent" },
];

const TYPE_SPEED = 34;
const HOLD_MS = 1500;

export default function AnswerReel() {
  const [index, setIndex] = useState(0);
  const [chars, setChars] = useState(0);

  const current = REEL[index];
  const done = chars >= current.snippet.length;

  useEffect(() => {
    if (!done) {
      const t = setTimeout(() => setChars((c) => c + 1), TYPE_SPEED);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setIndex((i) => (i + 1) % REEL.length);
      setChars(0);
    }, HOLD_MS);
    return () => clearTimeout(t);
  }, [done, chars]);

  return (
    <span className="inline-flex flex-col align-bottom">
      <span className="font-mono text-xs font-medium text-ember-600 dark:text-ember-400 whitespace-nowrap">
        {current.snippet.slice(0, chars)}
        {!done && <span className="stream-caret" aria-hidden="true" />}
      </span>
      <span className="font-mono text-eyebrow uppercase text-ink-400 whitespace-nowrap">
        {current.source} · p.{current.page}
      </span>
    </span>
  );
}
