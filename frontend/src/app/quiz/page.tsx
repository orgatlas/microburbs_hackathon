"use client";

import { useState } from "react";

import { FreshLink } from "@/components/FreshLink";
import { Gauge } from "@/components/Gauge";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { WeightBreakdown } from "@/components/WeightBreakdown";
import { ApiError, saveQuiz, sendProfileToExtension, useAccount } from "@/lib/account";
import {
  archetypeOf,
  CATEGORIES,
  categoriesOf,
  CHAPTERS,
  type Details,
  extensionProfile,
  flagsOf,
  learnedFrom,
  nextNode,
  percent,
  QUIZ,
  reasonsFrom,
  type Step,
  topMetricOf,
  weightsOf,
} from "@/lib/quiz";

type Screen = "welcome" | "question" | "details" | "profile" | "ready";

const GOLD = "inline-flex min-h-13 cursor-pointer items-center rounded-full bg-gold px-7 py-3 font-bold text-ink hover:bg-gold-light disabled:opacity-60";
const TEXT_BUTTON = "min-h-11 cursor-pointer font-bold text-forest underline hover:text-gold-deep";
const INPUT = "min-h-13 rounded-2xl border-2 border-[#b9a77f] bg-paper px-4 py-3 font-normal text-ink";
const TITLE = "font-display text-4xl leading-tight font-semibold md:text-5xl";

const READY_STEPS = [
  { title: "Pin MicroMatch", detail: "Click the puzzle piece in Chrome's toolbar, then pin MicroMatch so your score is always in view." },
  { title: "Open a listing", detail: "Browse realestate.com.au or Domain as usual. We'll find the address for you." },
  { title: "Read your needle", detail: "Click the MicroMatch icon to open your score beside the listing, then explore what's behind it." },
];

const numberFrom = (text: string) => Number(text.replace(/[^\d.]/g, ""));

function ChapterProgress({ active }: { active: number }) {
  return (
    <ol aria-label="Quiz chapters" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {CHAPTERS.map((chapter, index) => (
        <li
          key={chapter}
          aria-current={index === active ? "step" : undefined}
          className={index === active ? "border-b-[3px] border-gold font-bold" : "pb-[3px] text-muted"}
        >
          {chapter}
        </li>
      ))}
    </ol>
  );
}

export default function QuizPage() {
  const { account, failed } = useAccount();
  const [screen, setScreen] = useState<Screen>("welcome");
  const [node, setNode] = useState("Q1");
  const [trail, setTrail] = useState<Step[]>([]);
  const [mode, setMode] = useState<Details["mode"]>("buy");
  const [problem, setProblem] = useState("");
  const [saving, setSaving] = useState(false);
  const [connected, setConnected] = useState(false);

  const weights = weightsOf(trail);
  const categories = categoriesOf(weights);
  const flags = flagsOf(trail);
  const investor = flags.includes("investor") && !trail.some(([step]) => step === "F1");
  const renting = mode === "rent" && !investor;
  const question = QUIZ[node];
  const addressLabel = flags.includes("study")
    ? "Where do you study?"
    : flags.includes("work")
      ? "Where do you work?"
      : "Where do you go most days? (optional)";

  function pick(index: number) {
    const nextTrail: Step[] = [...trail, [node, index]];
    const next = nextNode(nextTrail);
    setTrail(nextTrail);
    if (next === "DETAILS") setScreen("details");
    else setNode(next);
  }

  function back() {
    const last = trail[trail.length - 1];
    setTrail(trail.slice(0, -1));
    setNode(last[0]);
    setScreen("question");
  }

  function restart() {
    setTrail([]);
    setNode("Q1");
    setScreen("welcome");
  }

  async function finish(form: FormData) {
    if (!account) return;
    const budget = numberFrom(String(form.get("budget") ?? ""));
    if (!budget) {
      setProblem("Enter your budget so we can work out affordability.");
      return;
    }
    const details: Details = {
      mode: renting ? "rent" : "buy",
      budget,
      income: numberFrom(String(form.get("income") ?? "")) || null,
      address: String(form.get("address") ?? "").trim(),
    };
    const profile = extensionProfile(account.user.name, weights, details, trail);
    setSaving(true);
    setProblem("");
    try {
      await saveQuiz({
        answers: trail,
        weights,
        categories,
        archetype: archetypeOf(weights),
        details,
        extension_profile: profile,
      });
      setScreen("profile");
      setConnected(await sendProfileToExtension(profile));
    } catch (failure) {
      setProblem(failure instanceof ApiError ? failure.message : "We couldn't save your quiz. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="text-lg leading-relaxed">
      <SiteHeader />
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        {failed && <p role="alert">{failed}</p>}
        {!account && !failed && <p className="text-body">Loading…</p>}

        {account && screen === "welcome" && (
          <div className="grid items-center gap-14 md:grid-cols-2">
            <div className="flex flex-col items-start gap-5">
              <h1 className="font-display text-5xl leading-tight font-semibold lg:text-6xl">
                First, tell us what home means to you.
              </h1>
              <p className="text-xl text-body">
                Every choice takes your story somewhere new. Your answers set the needle, so every listing is scored
                for your life.
              </p>
              <button type="button" onClick={() => setScreen("question")} className={GOLD}>Start my story</button>
              <p className="text-base text-muted">5 to 11 quick questions. We&apos;ll save your answers, and you can retake it any time.</p>
            </div>
            <div className="flex flex-col items-center gap-4 rounded-[28px] bg-butter p-10 text-center">
              <Gauge score={50} decorative className="block w-full max-w-80" />
              <p className="font-display text-2xl font-semibold">Your needle starts in the middle.</p>
              <p className="text-body">Commuting, Safety and Price all start equal. Your story decides what matters most.</p>
            </div>
          </div>
        )}

        {account && screen === "question" && (
          <>
            <ChapterProgress active={question.chapter} />
            <div className="flex flex-wrap items-start gap-10">
              <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
                <p className="font-bold text-gold-deep">Chapter {question.chapter + 1}: {CHAPTERS[question.chapter]}</p>
                <h1 className={`${TITLE} mb-2`}>{question.title}</h1>
                {question.answers.map((answer, index) => (
                  <button
                    key={answer.label}
                    type="button"
                    onClick={() => pick(index)}
                    className="min-h-17 cursor-pointer rounded-2xl border-2 border-sand bg-paper px-5.5 py-4 text-left text-xl font-bold hover:border-forest"
                  >
                    {answer.label}
                  </button>
                ))}
                {trail.length > 0 && (
                  <button type="button" onClick={back} className={`${TEXT_BUTTON} self-start`}>Go back a page</button>
                )}
              </div>
              <aside aria-label="What we've learned so far" className="flex min-w-0 flex-[1_1_300px] flex-col gap-4 rounded-3xl bg-butter p-6.5">
                <h2 className="font-display text-2xl font-semibold">Your balance so far</h2>
                {CATEGORIES.map((category) => (
                  <div key={category.key}>
                    <div className="flex justify-between gap-3">
                      <span>{category.label}</span>
                      <strong>{percent(categories[category.key])}</strong>
                    </div>
                    <div className="h-2.5 rounded-full bg-sand">
                      <div
                        className={`h-2.5 rounded-full transition-[width] duration-300 motion-reduce:transition-none ${category.bar}`}
                        style={{ width: `${categories[category.key] * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
                <p aria-live="polite" className="text-base text-body">{learnedFrom(trail)}</p>
              </aside>
            </div>
          </>
        )}

        {account && screen === "details" && (
          <form action={finish} className="mx-auto flex w-full max-w-2xl flex-col gap-5">
            <ChapterProgress active={4} />
            <p className="font-bold text-gold-deep">The last page</p>
            <h1 className={TITLE}>Two details so we can do the sums.</h1>
            <p className="text-body">These don&apos;t change what matters to you. They let us work out affordability and travel for each home.</p>
            {!investor && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Buying or renting">
                {(["buy", "rent"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={mode === option}
                    onClick={() => setMode(option)}
                    className={`min-h-11 cursor-pointer rounded-full border-2 border-forest px-4.5 py-2 text-base font-bold ${
                      mode === option ? "bg-forest text-white" : "text-forest"
                    }`}
                  >
                    {option === "buy" ? "I'm buying" : "I'm renting"}
                  </button>
                ))}
              </div>
            )}
            <label className="flex flex-col gap-1.5 font-bold">
              {renting ? "What's the most rent you'd pay each week?" : "What's the most you'd spend?"}
              <input name="budget" inputMode="numeric" required placeholder={renting ? "$650" : "$1,300,000"} className={INPUT} />
            </label>
            {renting && (
              <label className="flex flex-col gap-1.5 font-bold">
                Your weekly income (optional)
                <input name="income" inputMode="numeric" placeholder="$1,500" className={INPUT} />
              </label>
            )}
            {!investor && (
              <label className="flex flex-col gap-1.5 font-bold">
                {addressLabel}
                <input name="address" autoComplete="off" placeholder="188 Pitt Street, Sydney" className={INPUT} />
                <span className="text-base font-normal text-muted">We only use this to measure the distance from each home.</span>
              </label>
            )}
            {problem && <p role="alert" className="font-bold text-[#8f2f1f]">{problem}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={saving} className={GOLD}>{saving ? "Saving…" : "Save my profile"}</button>
              <button type="button" onClick={back} className={TEXT_BUTTON}>Go back a page</button>
            </div>
          </form>
        )}

        {account && screen === "profile" && (
          <>
            <div className="flex flex-col gap-2">
              <p className="font-bold text-gold-deep">The end of your story, and the start of your search</p>
              <h1 className={TITLE}>You&apos;re a {archetypeOf(weights)}.</h1>
              <p className="text-body">Your biggest priority is {topMetricOf(weights).toLowerCase()}. Here&apos;s how each home will be scored for you.</p>
            </div>
            <WeightBreakdown weights={weights} />
            <p className="rounded-2xl bg-butter px-6 py-5">
              <strong>Because you said:</strong> {reasonsFrom(trail).map((reason) => `“${reason}”`).join(", ")}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => setScreen("ready")} className={GOLD}>That sounds like me</button>
              <button
                type="button"
                onClick={restart}
                className="min-h-13 cursor-pointer rounded-full border-2 border-forest px-6 py-2.5 font-bold text-forest hover:bg-butter"
              >
                Start my story again
              </button>
            </div>
          </>
        )}

        {account && screen === "ready" && (
          <>
            <div className="flex flex-col gap-2">
              <h1 className={TITLE}>You&apos;re all set. Let&apos;s go house hunting.</h1>
              <p className="text-xl text-body">
                {connected ? "Your needle is ready for every listing you open." : "Your profile is saved. Install the extension, then open your dashboard to connect it."}
              </p>
            </div>
            <ol className="grid gap-4 md:grid-cols-3">
              {READY_STEPS.map((step, index) => (
                <li key={step.title} className="flex flex-col gap-2 rounded-2xl border border-sand bg-paper p-6">
                  <span className="font-display text-4xl leading-none font-semibold text-gold-deep">{index + 1}</span>
                  <h2 className="text-xl font-bold">{step.title}</h2>
                  <p className="text-body">{step.detail}</p>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap items-center gap-3">
              <a href="https://www.realestate.com.au/buy" className={GOLD}>Start browsing</a>
              <FreshLink href="/dashboard" className={TEXT_BUTTON}>Go to my dashboard</FreshLink>
            </div>
            <p className="text-base text-muted">
              Your profile is saved to your MicroMatch account and copied to the extension in this browser. The extension
              sends only the listing address and your work or uni address to look up facts.
            </p>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
