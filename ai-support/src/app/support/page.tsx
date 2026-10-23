"use client";

import Link from "next/link";
import { useState } from "react";

export default function SupportPage() {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>(
    [],
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const sendMessage = async () => {
    if (!input.trim()) return;
    const userMsg = { role: "user", content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    // TODO: Connect to AI backend
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "AI Support Agent coming soon! Upload your docs to get started.",
        },
      ]);
      setLoading(false);
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <header className="border-b border-[var(--line)] bg-[var(--surface)]/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="font-[family-name:var(--font-display)] text-lg font-bold"
            >
              Van<span className="text-[var(--accent)]">OS</span>
            </Link>
            <h1 className="text-sm text-[var(--muted-fg)] sm:text-base">
              AI Support (product)
            </h1>
          </div>
          <button
            type="button"
            className="rounded-lg bg-[var(--ink)] px-4 py-2 text-sm font-medium text-[var(--bg)]"
          >
            Upload Docs
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6">
          <h2 className="mb-4 font-[family-name:var(--font-display)] text-lg font-semibold">
            How it works
          </h2>
          <ol className="list-inside list-decimal space-y-2 text-[var(--muted-fg)]">
            <li>Upload your docs, PDFs, or paste URLs</li>
            <li>AI builds a knowledge base automatically</li>
            <li>Customers chat with your AI support agent</li>
          </ol>
        </div>

        <div className="flex h-96 flex-col rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="mb-4 flex-1 space-y-4 overflow-y-auto">
            {messages.length === 0 && (
              <p className="text-center text-[var(--muted-fg)]">
                Ask me anything about your docs…
              </p>
            )}
            {messages.map((msg, i) => (
              <div
                key={`${msg.role}-${i}`}
                className={`rounded-lg p-3 ${
                  msg.role === "user"
                    ? "ml-8 bg-[var(--accent-soft)]"
                    : "mr-8 bg-[var(--line)]/40"
                }`}
              >
                {msg.content}
              </div>
            ))}
            {loading && (
              <div className="text-[var(--muted-fg)]">Thinking…</div>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Ask a question…"
              className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-4 py-2 outline-none ring-[var(--accent)] focus:ring-2"
            />
            <button
              type="button"
              onClick={sendMessage}
              disabled={loading}
              className="rounded-lg bg-[var(--ink)] px-6 py-2 text-[var(--bg)] disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
