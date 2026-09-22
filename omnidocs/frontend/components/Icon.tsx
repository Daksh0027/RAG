import type { ComponentProps } from "react";

/**
 * The app's icon set, in one place.
 *
 * Every glyph is a 24x24 stroked path on `currentColor`, so an icon inherits
 * the colour and can be sized with a utility class. Keeping them here stops
 * the same path data from being pasted into four different pages.
 */
const paths: Record<string, string | string[]> = {
  arrowLeft: "M10 19l-7-7m0 0l7-7m-7 7h18",
  arrowRight: "M14 5l7 7m0 0l-7 7m7-7H3",
  chevronRight: "M9 5l7 7-7 7",
  document: "M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z",
  documentLines: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  chat: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
  warning: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
  sun: "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z",
  moon: "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z",
  send: "M12 19l9-7-9-7v14z",
  speaker: [
    "M11 5L6 9H2v6h4l5 4V5z",
    "M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728",
  ],
  close: "M6 18L18 6M6 6l12 12",
  plus: "M12 4v16m8-8H4",
  trash: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
  upload: "M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12",
  layers: "M19 11H5m14-7H5m14 14H5",
  table: "M3 10h18M3 14h18m-9-4v8m-7 4h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  search: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  check: "M5 13l4 4L19 7",
  refresh: "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15",
  stop: "M9 9h6v6H9z",
  omega: "M5 5v4a7 7 0 0014 0V5M5 5h4m6 0h4M9 5l3 4 3-4",
};

interface IconProps extends Omit<ComponentProps<"svg">, "children"> {
  name: keyof typeof paths | string;
  /** Stroke weight. Defaults to the 1.5 used across the interface. */
  weight?: number;
}

export default function Icon({ name, weight = 1.5, className = "w-5 h-5", ...rest }: IconProps) {
  const d = paths[name];
  if (!d) return null;
  const list = Array.isArray(d) ? d : [d];

  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
      {...rest}
    >
      {list.map((segment, i) => (
        <path
          key={i}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={weight}
          d={segment}
        />
      ))}
    </svg>
  );
}
