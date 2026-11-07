"use client";

import { useEffect, useState } from "react";

import { FreshLink } from "@/components/FreshLink";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { WeightBreakdown } from "@/components/WeightBreakdown";
import { logOut, sendProfileToExtension, useAccount } from "@/lib/account";
import { reasonsFrom } from "@/lib/quiz";

const BUTTON = "inline-flex min-h-13 items-center rounded-full bg-gold px-7 py-3 font-bold text-ink hover:bg-gold-light";

const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

export default function Dashboard() {
  const { account, failed } = useAccount();
  const [connected, setConnected] = useState<boolean | null>(null);
  const latest = account?.latest_quiz;

  useEffect(() => {
    if (latest) sendProfileToExtension(latest.extension_profile).then(setConnected);
  }, [latest]);

  async function signOut() {
    await logOut();
    window.location.assign("/");
  }

  return (
    <div className="text-lg leading-relaxed">
      <SiteHeader />
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
        {failed && <p role="alert">{failed}</p>}
        {!account && !failed && <p className="text-body">Loading your profile…</p>}
        {account && (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="font-bold text-gold-deep">Your dashboard</p>
                <h1 className="font-display text-5xl leading-tight font-semibold">Hi {account.user.name}.</h1>
              </div>
              <button
                type="button"
                onClick={signOut}
                className="min-h-11 cursor-pointer font-bold text-forest underline hover:text-gold-deep"
              >
                Log out
              </button>
            </div>

            {!latest && (
              <section className="flex flex-col items-start gap-4 rounded-3xl bg-butter p-8 md:p-12">
                <h2 className="font-display text-4xl leading-tight font-semibold">First, tell us what home means to you.</h2>
                <p className="max-w-2xl text-body">
                  Take the quiz to set your needle. It takes 5 to 11 quick questions, and you can retake it any time.
                </p>
                <FreshLink href="/quiz" className={BUTTON}>Start my story</FreshLink>
              </section>
            )}

            {latest && (
              <>
                <section className="flex flex-wrap items-center justify-between gap-5 rounded-3xl bg-forest p-8 text-paper">
                  <div className="flex flex-col gap-1">
                    <p className="font-bold text-gold-light">Your profile</p>
                    <h2 className="font-display text-4xl leading-tight font-semibold">You&apos;re a {latest.archetype}.</h2>
                    <p>Last updated {dateOf(latest.created_at)}.</p>
                  </div>
                  <FreshLink href="/quiz" className={BUTTON}>Retake the quiz</FreshLink>
                </section>
                <WeightBreakdown weights={latest.weights} />
                <p className="rounded-2xl bg-butter px-6 py-5">
                  <strong>Because you said:</strong>{" "}
                  {reasonsFrom(latest.answers).map((reason) => `“${reason}”`).join(", ")}
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  <section className="rounded-2xl border border-sand bg-paper p-5">
                    <h2 className="text-xl font-bold">Chrome extension</h2>
                    <p className="text-body" role="status">
                      {connected === null && "Checking for the extension…"}
                      {connected === true && "Connected. Your needle is ready on every listing."}
                      {connected === false && "Not found in this browser. Install it, then come back to this page to connect."}
                    </p>
                  </section>
                  <section className="rounded-2xl border border-sand bg-paper p-5">
                    <h2 className="text-xl font-bold">Your quiz history</h2>
                    <ul>
                      {account.history.map((item) => (
                        <li key={item.id} className="flex justify-between gap-3 text-base">
                          <span>{item.archetype}</span>
                          <span className="text-muted">{dateOf(item.created_at)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              </>
            )}
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
