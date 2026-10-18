import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import Icon from "../components/Icon";
import AnswerReel from "../components/AnswerReel";

/**
 * Redesigned landing page: an editorial, archive-inspired layout.
 *
 * Type does the heavy lifting — an oversized serif-free display sentence in
 * the hero, a rotating "answer reel" showing citations the way chat does,
 * and a four-stage walkthrough you read like a filing cabinet.
 */

const STAGES = [
  {
    n: "01",
    tab: "Upload",
    title: "Bring the paper in",
    desc: "Drop one PDF or forty. Extraction, chunking, and embedding run page by page in the background — scanned and bilingual files included.",
    detail: "pypdf · pymupdf · python-docx",
  },
  {
    n: "02",
    tab: "Group",
    title: "Build the workspace",
    desc: "Pull documents into a shared workspace so questions and comparisons run across all of them at once, not one file at a time.",
    detail: "workspaces · versioned indexing",
  },
  {
    n: "03",
    tab: "Ask",
    title: "Question the stack",
    desc: "Hybrid retrieval — vector similarity plus full-text search — pulls the passages that actually answer you, from every document at once.",
    detail: "pgvector HNSW · GIN tsvector",
  },
  {
    n: "04",
    tab: "Trace",
    title: "Follow it back",
    desc: "Every claim carries its citation. Click it and the exact page opens beside the answer, highlighted where the passage lives.",
    detail: "citations · page anchors",
  },
];

const FEATURES = [
  {
    icon: "document" as const,
    title: "Parsing that keeps the page",
    desc: "Layouts, tables, and two-column text are extracted with their page numbers intact, so evidence stays addressable.",
  },
  {
    icon: "table" as const,
    title: "Comparison as a ledger",
    desc: "Lift the same field out of many documents into one table. Matches, conflicts, and gaps are flagged for you.",
  },
  {
    icon: "chat" as const,
    title: "Answers, not vibes",
    desc: "The assistant is grounded in retrieved passages only. If the documents don't say it, it doesn't say it either.",
  },
];

export default function HomePage() {
  return (
    <div className="bg-surface text-ink-900 dark:text-ink-50 font-sans antialiased min-h-screen flex flex-col">
      <div className="mx-auto max-w-6xl w-full px-5 sm:px-8 flex flex-col flex-1">
        {/* Header */}
        <header className="flex items-center justify-between h-16 border-b border-hairline">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-ember-500 flex items-center justify-center text-white">
              <Icon name="omega" weight={2} className="w-4 h-4" />
            </div>
            <span className="font-display font-semibold text-lg tracking-tight">
              OmniDocs
            </span>
          </div>

          <nav className="flex items-center gap-1">
            <Show when="signed-out">
              <SignInButton mode="modal">
                <button className="h-9 px-4 rounded-md font-mono text-eyebrow uppercase text-ink-500 dark:text-ink-300 hover:text-ink-900 dark:hover:text-ink-50 hover:bg-ink-100 dark:hover:bg-ink-800 transition-colors cursor-pointer">
                  Sign in
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="h-9 px-4 rounded-md bg-ember-500 hover:bg-ember-600 text-white font-mono text-eyebrow uppercase transition-colors cursor-pointer">
                  Start free
                </button>
              </SignUpButton>
            </Show>
            <Show when="signed-in">
              <Link
                href="/dashboard"
                className="h-9 px-4 rounded-md bg-ember-500 hover:bg-ember-600 text-white font-mono text-eyebrow uppercase transition-colors inline-flex items-center"
              >
                Dashboard
              </Link>
              <div className="ml-1">
                <UserButton />
              </div>
            </Show>
          </nav>
        </header>

        <main className="flex-1">
          {/* Hero */}
          <section className="relative pt-16 sm:pt-24 pb-16 overflow-hidden">
            <div
              className="absolute inset-x-0 top-0 h-80 dot-grid-bg pointer-events-none"
              style={{
                maskImage: "linear-gradient(to bottom, black, transparent)",
                WebkitMaskImage: "linear-gradient(to bottom, black, transparent)",
              }}
            />

            <div className="relative">
              <p className="font-mono text-eyebrow uppercase text-ember-600 dark:text-ember-400 mb-6 animate-fade-up">
                [ Read across your documents ]
              </p>

              <h1 className="font-display text-display-lg sm:text-[5rem] font-semibold tracking-tight leading-[1.02] max-w-4xl animate-fade-up">
                Ask once.
                <br />
                Get the answer
                <br />
                <span className="text-ink-300 dark:text-ink-600">
                  and the page
                </span>{" "}
                <AnswerReel />
              </h1>

              <p className="mt-8 text-lg text-ink-500 dark:text-ink-400 leading-relaxed max-w-xl animate-fade-up">
                OmniDocs indexes every PDF you give it, then answers questions
                across the whole stack at once — each claim tied to the file and
                page it came from.
              </p>

              <div className="mt-9 flex flex-wrap items-center gap-3 animate-fade-up">
                <Show when="signed-out">
                  <SignUpButton mode="modal">
                    <button className="h-11 px-6 rounded-lg bg-ember-500 hover:bg-ember-600 text-white text-sm font-medium transition-colors cursor-pointer">
                      Upload your first PDF
                    </button>
                  </SignUpButton>
                </Show>
                <Show when="signed-in">
                  <Link
                    href="/dashboard"
                    className="h-11 px-6 rounded-lg bg-ember-500 hover:bg-ember-600 text-white text-sm font-medium transition-colors inline-flex items-center"
                  >
                    Go to dashboard
                  </Link>
                </Show>
                <a
                  href="https://github.com"
                  target="_blank"
                  rel="noreferrer"
                  className="h-11 px-6 rounded-lg border border-hairline inline-flex items-center text-sm font-medium text-ink-600 dark:text-ink-300 hover:border-ember-400 hover:text-ink-900 dark:hover:text-ink-50 transition-colors"
                >
                  See how it works
                </a>
              </div>
            </div>
          </section>

          {/* Statement with inline answer chips */}
          <section className="py-16 border-t border-hairline">
            <div className="max-w-3xl">
              <p className="font-mono text-eyebrow uppercase text-ink-400 mb-4">
                [ 01 / 03 ] &middot; The idea
              </p>
              <p className="font-display text-display font-semibold tracking-tight leading-[1.12]">
                Every document you own is a
                <span className="font-mono text-xs align-middle mx-2 px-2 py-1 rounded-md border border-hairline bg-surface-raised text-ink-500 dark:text-ink-300 whitespace-nowrap">
                  200-page question
                </span>
                you never got around to asking. OmniDocs reads all of them, so
                the answer arrives
                <span className="font-mono text-xs align-middle mx-2 px-2 py-1 rounded-md border border-signal-300/60 bg-signal-50 dark:border-signal-700/60 dark:bg-signal-900/40 text-signal-700 dark:text-signal-300 whitespace-nowrap">
                  cited, page and file
                </span>
                — and conflicts surface
                <span className="font-mono text-xs align-middle mx-2 px-2 py-1 rounded-md border border-alert-300/60 bg-alert-50 dark:border-alert-700/60 dark:bg-alert-900/40 text-alert-700 dark:text-alert-300 whitespace-nowrap">
                  before they cost you
                </span>
                .
              </p>
            </div>
          </section>

          {/* Photo duo */}
          <section className="pb-16">
            <div className="grid gap-5 sm:grid-cols-5">
              <figure className="sm:col-span-3 overflow-hidden rounded-xl border border-hairline animate-fade-up">
                <img
                  src="https://images.pexels.com/photos/4097125/pexels-photo-4097125.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
                  alt="Monochrome close-up of vintage typewriter keys"
                  className="w-full h-64 sm:h-80 object-cover grayscale hover:grayscale-0 transition-all duration-500"
                  loading="lazy"
                />
                <figcaption className="px-5 py-3 border-t border-hairline font-mono text-eyebrow uppercase text-ink-400">
                  The input: decades of paper, one query
                </figcaption>
              </figure>
              <figure className="sm:col-span-2 overflow-hidden rounded-xl border border-hairline animate-fade-up">
                <img
                  src="https://images.pexels.com/photos/6550462/pexels-photo-6550462.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
                  alt="Vintage card catalog drawer in an archive"
                  className="w-full h-64 sm:h-80 object-cover grayscale hover:grayscale-0 transition-all duration-500"
                  loading="lazy"
                />
                <figcaption className="px-5 py-3 border-t border-hairline font-mono text-eyebrow uppercase text-ink-400">
                  The index: every page, findable
                </figcaption>
              </figure>
            </div>
          </section>

          {/* Four-stage walkthrough */}
          <section className="py-16 border-t border-hairline">
            <div className="flex flex-wrap items-end justify-between gap-4 mb-10">
              <div className="max-w-xl">
                <p className="font-mono text-eyebrow uppercase text-ink-400 mb-3">
                  [ 02 / 03 ] &middot; How it works
                </p>
                <h2 className="font-display text-display text-ink-900 dark:text-ink-50">
                  Four moves, start to citation
                </h2>
              </div>
              <p className="font-mono text-eyebrow uppercase text-ink-400">
                drag / scroll &rarr;
              </p>
            </div>

            <div className="overflow-x-auto -mx-5 sm:-mx-8 px-5 sm:px-8 pb-2">
              <ol className="flex gap-5 min-w-max">
                {STAGES.map((stage) => (
                  <li
                    key={stage.n}
                    className="w-72 shrink-0 rounded-xl border border-hairline bg-surface-raised p-6 flex flex-col hover:border-ember-300 hover:-translate-y-0.5 transition-all duration-200"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-eyebrow uppercase text-ember-600 dark:text-ember-400 tabular-nums">
                        {stage.n}
                      </span>
                      <span className="font-mono text-eyebrow uppercase text-ink-400">
                        [ {stage.tab} ]
                      </span>
                    </div>
                    <h3 className="mt-5 font-display text-title text-ink-900 dark:text-ink-50">
                      {stage.title}
                    </h3>
                    <p className="mt-3 text-sm text-ink-500 dark:text-ink-400 leading-relaxed flex-1">
                      {stage.desc}
                    </p>
                    <p className="mt-6 pt-4 border-t border-hairline font-mono text-eyebrow uppercase text-ink-400">
                      {stage.detail}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* Feature cards */}
          <section className="py-16 border-t border-hairline">
            <div className="max-w-xl mb-10">
              <p className="font-mono text-eyebrow uppercase text-ink-400 mb-3">
                [ 03 / 03 ] &middot; Why OmniDocs
              </p>
              <h2 className="font-display text-display text-ink-900 dark:text-ink-50">
                Built for serious document work
              </h2>
            </div>

            <div className="grid gap-px bg-hairline rounded-xl overflow-hidden border border-hairline sm:grid-cols-3">
              {FEATURES.map((feature) => (
                <div key={feature.title} className="p-6 bg-surface-raised">
                  <div className="w-9 h-9 rounded-lg border border-hairline flex items-center justify-center text-ember-600 dark:text-ember-400">
                    <Icon name={feature.icon} className="w-4.5 h-4.5" />
                  </div>
                  <h3 className="mt-4 font-display text-heading text-ink-900 dark:text-ink-50">
                    {feature.title}
                  </h3>
                  <p className="mt-2 text-sm text-ink-500 dark:text-ink-400 leading-relaxed">
                    {feature.desc}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* CTA */}
          <section className="py-16">
            <div className="rounded-xl border border-hairline bg-surface-raised px-6 py-12 sm:px-12 text-center relative overflow-hidden">
              <div
                className="absolute inset-0 dot-grid-bg opacity-40 pointer-events-none"
                style={{
                  maskImage: "radial-gradient(ellipse at center, black, transparent 70%)",
                  WebkitMaskImage: "radial-gradient(ellipse at center, black, transparent 70%)",
                }}
              />
              <div className="relative">
                <h2 className="font-display text-title text-ink-900 dark:text-ink-50">
                  Ready to hear what your documents say?
                </h2>
                <p className="mt-3 text-ink-500 dark:text-ink-400 max-w-md mx-auto leading-relaxed">
                  Create a free account and upload your first PDF in under a minute.
                </p>
                <div className="mt-7 flex justify-center">
                  <Show when="signed-out">
                    <SignUpButton mode="modal">
                      <button className="h-11 px-6 rounded-lg bg-ember-500 hover:bg-ember-600 text-white text-sm font-medium transition-colors cursor-pointer">
                        Get started — it&apos;s free
                      </button>
                    </SignUpButton>
                  </Show>
                  <Show when="signed-in">
                    <Link
                      href="/dashboard"
                      className="h-11 px-6 rounded-lg bg-ember-500 hover:bg-ember-600 text-white text-sm font-medium transition-colors inline-flex items-center"
                    >
                      Go to dashboard
                    </Link>
                  </Show>
                </div>
              </div>
            </div>
          </section>
        </main>

        {/* Footer */}
        <footer className="border-t border-hairline">
          <div className="overflow-hidden pt-4" aria-hidden="true">
            <svg
              viewBox="0 0 1200 270"
              className="block w-full h-auto"
              role="presentation"
            >
              <text
                x="0"
                y="290"
                textLength="1200"
                lengthAdjust="spacingAndGlyphs"
                style={{
                  fontFamily: "var(--font-space-grotesk), sans-serif",
                  fontSize: 330,
                  fontWeight: 700,
                  letterSpacing: "-0.04em",
                  fill: "currentColor",
                }}
              >
                OmniDocs
              </text>
            </svg>
          </div>
          <div className="py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-ink-400">
              © {new Date().getFullYear()} OmniDocs. All rights reserved.
            </p>
            <nav className="flex items-center gap-5">
              {["Docs", "GitHub", "Privacy"].map((label) => (
                <a
                  key={label}
                  href="https://github.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-ink-400 hover:text-ink-900 dark:hover:text-ink-50 transition-colors"
                >
                  {label}
                </a>
              ))}
            </nav>
          </div>
          <p className="pb-6 text-[0.625rem] text-ink-400/70 leading-relaxed">
            Photography: Markus Winkler and Tima Miroshnichenko via Pexels.
          </p>
        </footer>
      </div>
    </div>
  );
}
