"use client";

import { type FormEvent, useState } from "react";

import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { ApiError, logIn, signUp } from "@/lib/account";

const INPUT = "min-h-13 rounded-2xl border-2 border-[#b9a77f] bg-paper px-4 py-3 text-ink";

export default function LoginPage() {
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const isSignup = mode === "signup";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setBusy(true);
    setProblem("");
    try {
      if (isSignup) await signUp(String(form.get("name")), email, password);
      else await logIn(email, password);
      window.location.assign("/dashboard");
    } catch (failure) {
      setProblem(failure instanceof ApiError ? failure.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="text-lg leading-relaxed">
      <SiteHeader />
      <main className="mx-auto flex max-w-lg flex-col gap-6 px-6 py-12">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-5xl leading-tight font-semibold">
            {isSignup ? "Let's get you home." : "Welcome back."}
          </h1>
          <p className="text-body">
            {isSignup
              ? "Create an account to save your quiz and retake it whenever life changes."
              : "Log in to see your profile and retake your quiz."}
          </p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {isSignup && (
            <label className="flex flex-col gap-1.5 font-bold">
              Your name
              <input name="name" required autoComplete="name" className={`${INPUT} font-normal`} />
            </label>
          )}
          <label className="flex flex-col gap-1.5 font-bold">
            Email
            <input name="email" type="email" required autoComplete="email" className={`${INPUT} font-normal`} />
          </label>
          <label className="flex flex-col gap-1.5 font-bold">
            Password
            <input
              name="password"
              type="password"
              required
              minLength={isSignup ? 8 : undefined}
              autoComplete={isSignup ? "new-password" : "current-password"}
              className={`${INPUT} font-normal`}
            />
          </label>
          {problem && <p role="alert" className="font-bold text-[#8f2f1f]">{problem}</p>}
          <button
            type="submit"
            disabled={busy}
            className="min-h-13 cursor-pointer rounded-full bg-gold px-7 py-3.5 font-bold text-ink hover:bg-gold-light disabled:opacity-60"
          >
            {busy ? "One moment…" : isSignup ? "Create my account" : "Log in"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => {
            setMode(isSignup ? "login" : "signup");
            setProblem("");
          }}
          className="min-h-11 cursor-pointer self-start font-bold text-forest underline hover:text-gold-deep"
        >
          {isSignup ? "Already have an account? Log in" : "New here? Create an account"}
        </button>
      </main>
      <SiteFooter />
    </div>
  );
}
