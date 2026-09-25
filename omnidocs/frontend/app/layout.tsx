import { ClerkProvider } from "@clerk/nextjs";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import { QueryProvider } from "../lib/query";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Display face: a geometric grotesque. Engineered rather than literary,
// which suits a tool that reads documents for a living.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Utility face: carries citations, filenames, page numbers, and field labels.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata = {
  title: "OmniDocs — Read across your documents",
  description:
    "Index your PDFs, ask questions across all of them at once, and get answers with the page they came from.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        suppressHydrationWarning
        className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
      >
        <head>
          {/* Applies the stored/system theme before hydration to avoid a
              flash of the wrong theme. Mirrors the logic in lib/theme.ts. */}
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){try{var t=localStorage.getItem('omnidocs-theme');var d=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d){document.documentElement.classList.add('dark');}}catch(e){}})();`,
            }}
          />
        </head>
        <body>
          <QueryProvider>{children}</QueryProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
