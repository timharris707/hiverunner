"use client";

import { useMemo } from "react";

interface MarkdownPreviewProps {
  content: string;
}

// Simple markdown to HTML converter
function parseMarkdown(markdown: string): string {
  let html = markdown;

  // Escape HTML entities first
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks with syntax highlighting hint
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_, lang, code) =>
      `<pre style="background-color: var(--background); border-radius: 0.5rem; padding: 1rem; overflow-x: auto; margin: 1rem 0;"><code style="font-size: 0.875rem; font-family: monospace; color: var(--accent);" data-lang="${lang}">${code.trim()}</code></pre>`
  );

  // Inline code
  html = html.replace(
    /`([^`]+)`/g,
    '<code style="background-color: var(--background); color: var(--accent); padding: 0.125rem 0.375rem; border-radius: 0.25rem; font-size: 0.875rem; font-family: monospace;">$1</code>'
  );

  // Headers
  html = html.replace(
    /^### (.+)$/gm,
    '<h3 style="font-size: 1.125rem; font-weight: 600; color: var(--text-primary); margin-top: 1.5rem; margin-bottom: 0.75rem;">$1</h3>'
  );
  html = html.replace(
    /^## (.+)$/gm,
    '<h2 style="font-size: 1.25rem; font-weight: bold; color: var(--text-primary); margin-top: 2rem; margin-bottom: 1rem;">$1</h2>'
  );
  html = html.replace(
    /^# (.+)$/gm,
    '<h1 style="font-size: 1.5rem; font-weight: bold; color: var(--text-primary); margin-top: 2rem; margin-bottom: 1rem;">$1</h1>'
  );

  // Bold and italic
  html = html.replace(
    /\*\*(.+?)\*\*/g,
    '<strong style="font-weight: bold;">$1</strong>'
  );
  html = html.replace(/\*(.+?)\*/g, '<em style="font-style: italic;">$1</em>');
  html = html.replace(
    /__(.+?)__/g,
    '<strong style="font-weight: bold;">$1</strong>'
  );
  html = html.replace(/_(.+?)_/g, '<em style="font-style: italic;">$1</em>');

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" style="color: var(--accent);" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // Blockquotes
  html = html.replace(
    /^&gt; (.+)$/gm,
    '<blockquote style="border-left: 4px solid var(--accent); padding-left: 1rem; padding-top: 0.25rem; padding-bottom: 0.25rem; margin: 0.5rem 0; color: var(--text-secondary); font-style: italic;">$1</blockquote>'
  );

  // Horizontal rules
  html = html.replace(
    /^---$/gm,
    '<hr style="border-color: var(--border); margin: 1.5rem 0;" />'
  );

  // Unordered lists
  html = html.replace(
    /^[\-\*] (.+)$/gm,
    '<li style="margin-left: 1rem; list-style-type: disc; list-style-position: inside; color: var(--text-secondary);">$1</li>'
  );

  // Ordered lists
  html = html.replace(
    /^\d+\. (.+)$/gm,
    '<li style="margin-left: 1rem; list-style-type: decimal; list-style-position: inside; color: var(--text-secondary);">$1</li>'
  );

  // Checkboxes
  html = html.replace(
    /\[x\]/gi,
    '<span style="display: inline-flex; align-items: center; justify-content: center; width: 1rem; height: 1rem; border-radius: 0.25rem; background-color: var(--accent); color: var(--text-primary); margin-right: 0.5rem;">✓</span>'
  );
  html = html.replace(
    /\[ \]/g,
    '<span style="display: inline-flex; align-items: center; justify-content: center; width: 1rem; height: 1rem; border-radius: 0.25rem; border: 1px solid var(--border); margin-right: 0.5rem;"></span>'
  );

  // Paragraphs (lines with content that aren't already wrapped)
  const lines = html.split("\n");
  const processedLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return "<br />";
    if (
      trimmed.startsWith("<h") ||
      trimmed.startsWith("<pre") ||
      trimmed.startsWith("<li") ||
      trimmed.startsWith("<blockquote") ||
      trimmed.startsWith("<hr") ||
      trimmed.startsWith("<br")
    ) {
      return line;
    }
    return `<p style="color: var(--text-secondary); margin: 0.5rem 0;">${line}</p>`;
  });

  return processedLines.join("\n");
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const html = useMemo(() => parseMarkdown(content), [content]);

  return (
    <div
      className="h-full overflow-auto p-6"
      style={{ backgroundColor: "var(--card)" }}
    >
      <div
        className="prose prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
