"use client";

// Last-resort page when the root layout itself fails: plain HTML, no app styles.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-GB">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", textAlign: "center", margin: 0 }}>
        <div>
          <h1 style={{ fontWeight: 300 }}>Something went wrong</h1>
          <p style={{ color: "#666" }}>Please try again{error.digest ? ` (reference ${error.digest})` : ""}.</p>
          <button onClick={reset} style={{ marginTop: 16, padding: "8px 16px", borderRadius: 4, border: 0, background: "#0b6e70", color: "#fff" }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
