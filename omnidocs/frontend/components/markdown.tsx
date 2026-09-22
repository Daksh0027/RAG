import type { Components } from "react-markdown";

/**
 * Shared ReactMarkdown renderer overrides for assistant answers.
 *
 * Both chat surfaces render model output, and previously each carried its own
 * copy of this map — which meant they drifted. One definition keeps an answer
 * looking the same wherever it appears.
 */
export const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => (
    <strong className="font-semibold text-ink-900 dark:text-ink-50">{children}</strong>
  ),
  em: ({ children }) => <em className="italic text-ink-500 dark:text-ink-300">{children}</em>,
  ul: ({ children }) => <ul className="list-disc list-outside space-y-1 my-2 pl-4">{children}</ul>,
  ol: ({ children }) => (
    <ol className="list-decimal list-outside space-y-1 my-2 pl-4">{children}</ol>
  ),
  li: ({ children }) => <li className="text-ink-700 dark:text-ink-200">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-ember-600 dark:text-ember-400 underline underline-offset-2 decoration-ember-300 dark:decoration-ember-700 hover:decoration-ember-500"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="px-1.5 py-0.5 rounded bg-ink-100 dark:bg-ink-800 text-ember-700 dark:text-ember-300 font-mono text-[0.8125em]">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 p-3 rounded-lg bg-ink-50 dark:bg-ink-950 border border-hairline overflow-x-auto text-xs font-mono">
      {children}
    </pre>
  ),
  h1: ({ children }) => (
    <h1 className="font-display text-heading text-ink-900 dark:text-ink-50 mt-4 mb-1.5">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="font-display text-heading text-ink-900 dark:text-ink-50 mt-4 mb-1.5">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-ink-800 dark:text-ink-100 mt-3 mb-1">{children}</h3>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-ember-400 pl-3 my-2 text-ink-500 dark:text-ink-300">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-hairline">
      <table className="w-full text-left text-xs" data-tabular>
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 bg-ink-50 dark:bg-ink-900 font-mono text-eyebrow uppercase text-ink-500 dark:text-ink-400 border-b border-hairline">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 border-b border-hairline last:border-0 align-top">{children}</td>
  ),
  hr: () => <hr className="my-4 border-hairline" />,
};
