import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import Icon from "../components/Icon";

/**
 * The ledger is the page's thesis: three leases that disagree.
 *
 * It's real markup rather than a screenshot so it stays legible at every
 * width, and it says what the product does more directly than a paragraph
 * about it would.
 */
const LEDGER_COLUMNS = ["Lease_A.pdf", "Lease_B.pdf", "Lease_C.pdf"];

const LEDGER_ROWS: {
  field: string;
  values: { value: string; page: number; status: "match" | "conflict" | "missing" }[];
}[] = [
  {
    field: "Monthly rent",
    values: [
      { value: "$4,200", page: 2, status: "match" },
      { value: "$4,200", page: 1, status: "match" },
      { value: "$4,200", page: 2, status: "match" },
    ],
  },
  {
    field: "Termination notice",
    values: [
      { value: "30 days", page: 7, status: "conflict" },
      { value: "60 days", page: 5, status: "conflict" },
      { value: "30 days", page: 8, status: "conflict" },
    ],
  },
  {
    field: "Sublet permitted",
    values: [
      { value: "Yes, with consent", page: 9, status: "match" },
      { value: "Yes, with consent", page: 6, status: "match" },
      { value: "Not addressed", page: 0, status: "missing" },
    ],
  },
];

function Ledger() {
  return (
    <div className="w-full rounded-xl border border-hairline bg-surface-raised shadow-[0_20px_60px_-30px_rgba(11,15,20,0.45)] dark:shadow-none overflow-hidden animate-fade-up">
      <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-hairline">
        <p className="font-mono text-eyebrow uppercase text-ink-400">[ Extract &amp; compare ]</p>
        <p className="font-mono text-eyebrow uppercase text-ink-400 hidden sm:block">
          3 documents · <span className="text-alert-500">1 conflict</span>
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-tabular>
          <thead>
            <tr className="border-b border-hairline">
              <th className="text-left font-mono text-eyebrow uppercase text-ink-400 px-4 sm:px-5 py-2.5 min-w-[10rem]">
                Field
              </th>
              {LEDGER_COLUMNS.map((name, i) => (
                <th key={name} className="text-left px-4 sm:px-5 py-2.5 min-w-[9rem] border-l border-hairline">
                  <span className="font-mono text-eyebrow text-ink-300 dark:text-ink-600">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="block font-mono text-xs font-normal text-ink-600 dark:text-ink-300 truncate">
                    {name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LEDGER_ROWS.map((row) => {
              const hasConflict = row.values.some((v) => v.status === "conflict");
              return (
                <tr key={row.field} className="border-b border-hairline last:border-0 align-top">
                  <th
                    scope="row"
                    className="text-left px-4 sm:px-5 py-3.5 font-medium text-ink-800 dark:text-ink-100"
                  >
                    <span className="flex items-start gap-2">
                      {hasConflict && (
                        <span className="mt-1.5 w-1 h-1 rounded-full bg-alert-500 shrink-0" />
                      )}
                      <span className="text-xs leading-snug">{row.field}</span>
                    </span>
                  </th>
                  {row.values.map((cell, i) => (
                    <td key={i} className="px-4 sm:px-5 py-3.5 border-l border-hairline">
                      {cell.status === "missing" ? (
                        <span className="text-xs text-ink-400 italic">Not addressed</span>
                      ) : (
                        <span
                          className={`font-mono text-xs leading-relaxed ${
                            cell.status === "conflict"
                              ? "text-alert-700 dark:text-alert-300"
                              : "text-ink-700 dark:text-ink-200"
                          }`}
                        >
                          {cell.value}
                        </span>
                      )}
                      {cell.page > 0 && (
                        <span className="block mt-1 font-mono text-eyebrow text-ink-400">
                          p.{cell.page}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 sm:px-5 py-3 border-t border-hairline flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-ember-500" />
        <p className="text-xs text-ink-500 dark:text-ink-400">
          Each cell opens the exact page it came from.
        </p>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="bg-surface text-ink-900 dark:text-ink-50 font-sans antialiased">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
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
                  Get started
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

        {/* Hero */}
        <main className="relative pt-16 sm:pt-24 pb-16 overflow-hidden">
          <div
            className="absolute inset-x-0 top-0 h-72 dot-grid-bg pointer-events-none"
            style={{ maskImage: "linear-gradient(to bottom, black, transparent)", WebkitMaskImage: "linear-gradient(to bottom, black, transparent)" }}
          />

          <div className="relative max-w-3xl animate-fade-up">
            <div className="flex flex-wrap items-center gap-2 mb-5">
              <span className="font-mono text-eyebrow uppercase text-ember-600 dark:text-ember-400">
                Read across your documents
              </span>
            </div>
            <h1 className="font-display text-display-lg sm:text-display-lg font-semibold tracking-tight text-ink-900 dark:text-ink-50">
              See where your documents
              <br className="hidden sm:block" />{" "}
              <span className="text-ink-300 dark:text-ink-600">disagree.</span>
            </h1>
            <p className="mt-5 text-lg text-ink-500 dark:text-ink-400 leading-relaxed max-w-xl">
              Upload your PDFs. OmniDocs indexes them, then answers questions across all of
              them at once — every claim tied to the file and page it came from.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              {["INDEXED", "CITED", "NO GUESSING"].map((tag) => (
                <span
                  key={tag}
                  className="font-mono text-eyebrow uppercase px-2 py-1 rounded-md border border-hairline text-ink-400 dark:text-ink-500"
                >
                  [ {tag} ]
                </span>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3">
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
              <a
                href="https://github.com"
                target="_blank"
                rel="noreferrer"
                className="h-11 px-6 rounded-lg border border-hairline inline-flex items-center text-sm font-medium text-ink-600 dark:text-ink-300 hover:border-ember-400 hover:text-ink-900 dark:hover:text-ink-50 transition-colors"
              >
                Read the docs
              </a>
            </div>
          </div>

          <div className="relative mt-14">
            <Ledger />
          </div>
        </main>

        {/* How it works */}
        <section className="py-16 border-t border-hairline">
          <div className="max-w-2xl">
            <p className="font-mono text-eyebrow uppercase text-ink-400 mb-3">
              [ 01 / 03 ] &middot; How it works
            </p>
            <h2 className="font-display text-display text-ink-900 dark:text-ink-50">
              From documents to synthesis
            </h2>
            <p className="mt-3 text-ink-500 dark:text-ink-400 leading-relaxed">
              No pipelines to configure. Upload, group, and trace every answer to its source.
            </p>
          </div>

          <div className="mt-10 grid gap-px bg-hairline rounded-xl overflow-hidden border border-hairline sm:grid-cols-3">
            {[
              {
                n: "01",
                title: "Upload your documents",
                desc: "Drop in one or more PDFs. OmniDocs extracts, chunks, and embeds the content automatically in the background.",
              },
              {
                n: "02",
                title: "Group into a workspace",
                desc: "Select multiple documents to open the comparison canvas — fields side-by-side, or questions across all of them.",
              },
              {
                n: "03",
                title: "Trace every answer",
                desc: "Click any citation to jump straight to the page it came from. No guesswork, no invented claims.",
              },
            ].map((step) => (
              <div key={step.n} className="p-6 bg-surface-raised">
                <p className="font-mono text-eyebrow text-ember-600 dark:text-ember-400 tabular-nums">
                  {step.n}
                </p>
                <h3 className="mt-3 font-display text-heading text-ink-900 dark:text-ink-50">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm text-ink-500 dark:text-ink-400 leading-relaxed">
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Feature cards */}
        <section className="py-16 border-t border-hairline">
          <div className="max-w-2xl">
            <p className="font-mono text-eyebrow uppercase text-ink-400 mb-3">
              [ 02 / 03 ] &middot; Why OmniDocs
            </p>
            <h2 className="font-display text-display text-ink-900 dark:text-ink-50">
              Built for serious document work
            </h2>
          </div>

          <div className="mt-10 grid gap-px bg-hairline rounded-xl overflow-hidden border border-hairline sm:grid-cols-3">
            {[
              {
                icon: "document" as const,
                title: "Smart parsing",
                desc: "Text extraction, chunking, and embedding happen automatically — page by page, even in scanned or bilingual PDFs.",
              },
              {
                icon: "table" as const,
                title: "Cross-document comparison",
                desc: "Extract structured fields across many documents into one table, with agreements and conflicts flagged automatically.",
              },
              {
                icon: "chat" as const,
                title: "Cited answers",
                desc: "Every claim links back to its source document and page. Click a citation to jump straight to the evidence.",
              },
            ].map((feature) => (
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
          <p className="font-mono text-eyebrow uppercase text-ink-400 mb-3">
            [ 03 / 03 ] &middot; Get started
          </p>
          <div className="rounded-xl border border-hairline bg-surface-raised px-6 py-12 sm:px-12 text-center">
            <h2 className="font-display text-title text-ink-900 dark:text-ink-50">
              Ready to see what your documents say?
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
        </section>

        {/* Footer */}
        <footer className="py-8 border-t border-hairline flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-ember-500 flex items-center justify-center text-white">
              <Icon name="omega" weight={2} className="w-3 h-3" />
            </div>
            <p className="text-xs text-ink-400">
              © {new Date().getFullYear()} OmniDocs. All rights reserved.
            </p>
          </div>
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
        </footer>
      </div>
    </div>
  );
}

