import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import "./homepage.css";

export default function HomePage() {
  return (
    <div className="homepage-container">
      {/* Header */}
      <header className="header">
        <div className="header-container">
          <div className="logo-container">
            <div className="logo-icon">
              <span className="font-display font-bold text-lg text-slate-900">Ω</span>
            </div>
            <span className="logo-text">
              OmniDocs
            </span>
          </div>

          <nav className="nav-container">
            <Show when="signed-out">
              <SignInButton mode="modal">
                <button className="btn-text">
                  Sign In
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="btn-secondary">
                  Sign Up
                </button>
              </SignUpButton>
            </Show>
            <Show when="signed-in">
              <Link href="/dashboard" className="nav-link-dashboard">
                Dashboard
              </Link>
              <div className="user-button-wrapper">
                <UserButton />
              </div>
            </Show>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <main className="hero-section">
        <div className="hero-grid" />

        <div className="hero-content">
          <div className="badge">
            <span className="badge-dot" />
            RESEARCH WORKSPACE FOR DOCUMENTS
          </div>

          <h1 className="hero-title">
            Find the thread that <span className="hero-title-accent">connects</span> your documents
          </h1>

          <p className="hero-desc">
            OmniDocs synthesizes across many sources at once &mdash; comparing, cross-referencing,
            and citing every claim back to the exact page it came from.
          </p>

          <div className="actions-container">
            <Show when="signed-out">
              <SignUpButton mode="modal">
                <button className="btn-primary">
                  Get Started for Free
                </button>
              </SignUpButton>
            </Show>
            <Show when="signed-in">
              <Link href="/dashboard" className="btn-primary-link">
                Go to Dashboard
              </Link>
            </Show>
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className="btn-tertiary"
            >
              Read Docs
            </a>
          </div>
        </div>
      </main>

      {/* Stats strip */}
      <section className="stats-strip">
        <div className="stat-item">
          <p className="stat-value">3K+</p>
          <p className="stat-label">Pages Indexed</p>
        </div>
        <div className="stat-item">
          <p className="stat-value">50+</p>
          <p className="stat-label">Languages</p>
        </div>
        <div className="stat-item">
          <p className="stat-value">&lt;2s</p>
          <p className="stat-label">Avg. Response</p>
        </div>
        <div className="stat-item">
          <p className="stat-value">100%</p>
          <p className="stat-label">Cited Answers</p>
        </div>
      </section>

      {/* Connection preview */}
      <section className="connection-preview">
        <div className="connection-card">
          <span className="connection-doc-chip">
            <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Contract_A.pdf
          </span>
          <svg className="w-10 h-4 text-teal-400 shrink-0" viewBox="0 0 40 16" fill="none">
            <path d="M1 8H39" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
            <circle cx="20" cy="8" r="3" fill="currentColor" opacity="0.6" />
          </svg>
          <span className="connection-doc-chip">
            <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Contract_B.pdf
          </span>
          <p className="text-sm text-zinc-300 font-normal flex-1 text-center sm:text-left">
            <span className="text-teal-400 font-mono text-xs mr-2">MATCH</span>
            Payment terms differ &mdash; 30 vs. 45 days, cited on pages 3 and 5.
          </p>
        </div>
      </section>

      {/* Feature Grid */}
      <section className="features-section">
        <div className="section-heading">
          <h2 className="section-title">Built for serious document work</h2>
          <p className="section-subtitle">
            Every answer is grounded in your own files &mdash; nothing invented, nothing untraceable.
          </p>
        </div>

        <div className="features-grid">
          <div className="feature-card accent-amber group">
            <div className="feature-icon-wrapper accent-amber">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="feature-title">Smart Parsing</h3>
            <p className="feature-desc">
              Upload any PDF and let our semantic parsers clean, chunk, and index content
              automatically, page by page.
            </p>
          </div>

          <div className="feature-card accent-teal group">
            <div className="feature-icon-wrapper accent-teal">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h3 className="feature-title">Cross-Document Comparison</h3>
            <p className="feature-desc">
              Extract structured fields across multiple documents into a single table &mdash;
              conflicts and matches flagged automatically.
            </p>
          </div>

          <div className="feature-card accent-slate group">
            <div className="feature-icon-wrapper accent-slate">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="feature-title">Cited Answers</h3>
            <p className="feature-desc">
              Every claim links back to its source document and page &mdash; click a citation to
              jump straight to the evidence.
            </p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="steps-section">
        <div className="section-heading">
          <h2 className="section-title">From documents to synthesis in three steps</h2>
          <p className="section-subtitle">No setup, no pipelines to configure &mdash; just upload and ask.</p>
        </div>

        <div className="steps-grid">
          <div className="step-card">
            <div className="step-number">01</div>
            <h3 className="step-title">Upload your documents</h3>
            <p className="step-desc">
              Drop in one or more PDFs. OmniDocs extracts, chunks, and embeds the content
              automatically in the background.
            </p>
          </div>
          <div className="step-card">
            <div className="step-number">02</div>
            <h3 className="step-title">Group into a workspace</h3>
            <p className="step-desc">
              Select multiple documents to open the research canvas &mdash; compare fields
              side-by-side or ask questions across all of them.
            </p>
          </div>
          <div className="step-card">
            <div className="step-number">03</div>
            <h3 className="step-title">Trace every answer to its source</h3>
            <p className="step-desc">
              Click any citation to jump straight to the page it came from &mdash; no guesswork,
              no hallucinated claims.
            </p>
          </div>
        </div>
      </section>

      {/* CTA banner */}
      <section className="cta-section">
        <div className="cta-card">
          <h2 className="cta-title">Ready to synthesize your documents?</h2>
          <p className="cta-desc">
            Create a free account and upload your first PDF in under a minute.
          </p>
          <div className="actions-container relative z-10">
            <Show when="signed-out">
              <SignUpButton mode="modal">
                <button className="btn-primary">
                  Get Started for Free
                </button>
              </SignUpButton>
            </Show>
            <Show when="signed-in">
              <Link href="/dashboard" className="btn-primary-link">
                Go to Dashboard
              </Link>
            </Show>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-container">
          <div className="footer-brand">
            <div className="w-6 h-6 rounded-md bg-amber-500 flex items-center justify-center">
              <span className="font-display font-bold text-xs text-slate-900">Ω</span>
            </div>
            <span>&copy; {new Date().getFullYear()} OmniDocs. All rights reserved.</span>
          </div>
          <div className="footer-links">
            <a href="https://github.com" target="_blank" rel="noreferrer">Docs</a>
            <a href="https://github.com" target="_blank" rel="noreferrer">GitHub</a>
            <a href="https://github.com" target="_blank" rel="noreferrer">Privacy</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
