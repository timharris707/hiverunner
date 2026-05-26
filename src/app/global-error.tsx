"use client";

// Minimal global error boundary — kept simple to avoid SSR prerender crash
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <h1>Error</h1>
        <button onClick={() => reset()}>Retry</button>
      </body>
    </html>
  );
}
