"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type State = "idle" | "sending" | "done" | "error";

export function Waitlist({ tone = "default" }: { tone?: "default" | "inverse" }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    try {
      const { error } = await createClient().from("waitlist").insert({ email: email.trim().toLowerCase() });
      // 23505 = already on the list, which is a success from the visitor's side.
      if (error && error.code !== "23505") throw error;
      setState("done");
      setMessage("You're on the list. We'll send the first build when it can quote your idea.");
    } catch {
      setState("error");
      setMessage("That didn't go through. Try again in a moment.");
    }
  }

  const inverse = tone === "inverse";

  if (state === "done") {
    return <p className={`font-mono text-sm ${inverse ? "text-paper" : "text-ink"}`}>{message}</p>;
  }

  return (
    <form onSubmit={submit} className="w-full max-w-md">
      <div
        className={`flex rounded-full border p-1 ${
          inverse ? "border-paper/25 bg-paper/5" : "border-rule bg-paper"
        }`}
      >
        <label htmlFor={`email-${tone}`} className="sr-only">
          Email
        </label>
        <input
          id={`email-${tone}`}
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@workshop.com"
          className={`min-w-0 flex-1 bg-transparent px-4 text-[15px] outline-none ${
            inverse ? "text-paper placeholder:text-paper/50" : "placeholder:text-muted"
          }`}
        />
        <button
          type="submit"
          disabled={state === "sending"}
          className="shrink-0 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink transition hover:brightness-110 disabled:opacity-60"
        >
          {state === "sending" ? "Joining…" : "Get early access"}
        </button>
      </div>
      {state === "error" && <p className="mt-2 pl-4 text-sm text-accent">{message}</p>}
    </form>
  );
}
