import Link from "next/link";
import type { ReactNode } from "react";

import { BuyerScores } from "@/components/BuyerScores";
import { Gauge } from "@/components/Gauge";
import { ScoreBar } from "@/components/ScoreBar";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

const INSTALL_URL = "https://github.com/orgatlas/microburbs_hackathon#run-it";

const HEADING = "font-display text-4xl leading-tight font-semibold md:text-5xl";
const SPLIT = "mx-auto grid max-w-6xl items-center gap-14 md:grid-cols-2";
const GOLD_BUTTON = "rounded-full bg-gold font-bold text-ink no-underline hover:bg-gold-light";

const HEADS_UPS = [
  {
    title: "Likely above your budget",
    detail: "The estimated price range starts above the limit you set.",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5M12 16h.01" />
      </>
    ),
  },
  {
    title: "Flood area close by",
    detail: "It's not on the property, but worth asking about at the inspection.",
    icon: <path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11Z" />,
  },
  {
    title: "Fewer bedrooms than you need",
    detail: "You asked for three, and this home has two.",
    icon: <path d="M3 18v-6h18v6M3 15h18M6 12V8h12v4" />,
  },
];

const ANSWERS = [
  { question: "How far is the train?", answer: "About a six minute walk." },
  { question: "Can I walk to the shops?", answer: "Yes, there's a supermarket three minutes away." },
  { question: "Does it feel safe around here?", answer: "Crime here is close to the national average." },
];

const STEPS = [
  {
    title: "Add it to Chrome",
    detail: "Then take a short quiz about your budget, your household and what you love.",
  },
  {
    title: "Browse like you always do",
    detail: "Open a listing on realestate.com.au or Domain. We'll find the address.",
  },
  {
    title: "Read your match score",
    detail: "The needle shows your fit at a glance. Open it up across Lifestyle & Community, Price and Safety.",
  },
];

const SCORE_KEY = [
  { label: "80+ Strong", className: "bg-forest" },
  { label: "60 to 79 Good", className: "bg-sage" },
  { label: "40 to 59 Mixed", className: "bg-gold" },
  { label: "Under 40 Weak", className: "bg-sand" },
];

function HouseIllustration() {
  return (
    <svg viewBox="0 0 320 210" className="block w-full rounded-xl" aria-hidden="true">
      <rect width="320" height="210" fill="#dce8df" />
      <circle cx="262" cy="50" r="24" fill="#f2c57c" />
      <rect y="172" width="320" height="38" fill="#a9c2ae" />
      <circle cx="46" cy="130" r="38" fill="#6f9a80" />
      <rect x="42" y="140" width="8" height="40" fill="#7a5a44" />
      <rect x="104" y="86" width="132" height="92" fill="#ebcf8e" />
      <path d="M92 90 170 34l78 56Z" fill="#d4a017" />
      <rect x="156" y="122" width="30" height="56" rx="15" fill="#1f5a41" />
      <rect x="118" y="108" width="26" height="28" rx="3" fill="#fbf5ea" />
      <rect x="198" y="108" width="26" height="28" rx="3" fill="#fbf5ea" />
    </svg>
  );
}

function ProductPreview() {
  return (
    <figure
      className="m-0 overflow-hidden rounded-3xl border border-sand bg-paper"
      aria-label="Example of the MicroMatch panel beside a property listing"
    >
      <div className="flex items-center gap-2 bg-butter px-4 py-3">
        <span className="size-2.5 rounded-full bg-sand" />
        <span className="size-2.5 rounded-full bg-sand" />
        <span className="size-2.5 rounded-full bg-sand" />
        <span className="ml-2 min-w-0 flex-1 truncate rounded-full bg-paper px-3.5 py-0.5 text-sm text-muted">
          A property listing you&apos;re viewing
        </span>
        <span className="rounded-lg bg-forest px-2 py-0.5 text-sm font-bold text-white">82</span>
      </div>
      <div className="flex flex-wrap">
        <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-3 p-4">
          <HouseIllustration />
          <div className="h-3 w-4/5 rounded-md bg-sand/60" />
          <div className="h-3 w-1/2 rounded-md bg-sand/60" />
        </div>
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-3 bg-parchment p-4">
          <p className="text-sm leading-snug text-muted">
            Example match for
            <br />
            26 Example Street, Surry Hills
          </p>
          <Gauge score={82} className="mx-auto block w-full max-w-72" />
          <div className="text-center">
            <div className="font-display text-5xl leading-none font-semibold">82</div>
            <div className="font-bold text-forest">Strong match</div>
          </div>
          <div className="flex flex-col gap-2 text-sm">
            <ScoreBar label="Lifestyle & Community" score={91} />
            <ScoreBar label="Price" score={78} />
            <ScoreBar label="Safety" score={72} />
          </div>
        </div>
      </div>
    </figure>
  );
}

function HeadsUp({ title, detail, icon }: { title: string; detail: string; icon: ReactNode }) {
  return (
    <div className="flex gap-4 rounded-2xl border border-sand bg-paper p-5">
      <svg
        className="size-7 flex-none stroke-gold-deep"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {icon}
      </svg>
      <div>
        <strong>{title}</strong>
        <p className="text-base text-body">{detail}</p>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="text-lg leading-relaxed">
      <SiteHeader />

      <main>
        <section id="top" className={`${SPLIT} px-6 pt-12 pb-22`}>
          <div className="flex flex-col items-start gap-6">
            <h1 className="font-display text-5xl leading-[1.05] font-semibold tracking-tight lg:text-7xl">
              Find the home that feels like yours.
            </h1>
            <p className="max-w-xl text-xl text-body">
              Every listing looks lovely in photos. MicroMatch is a Chrome extension that gets to know
              you, then gives each home a match score for the way you live.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <a href="#get" className={`${GOLD_BUTTON} px-7 py-3.5`}>Get the Chrome extension</a>
              <a
                href="#how"
                className="rounded-full border-2 border-forest px-5 py-3 font-bold text-forest hover:bg-butter"
              >
                See how it works
              </a>
            </div>
            <p className="text-base text-muted">Works on realestate.com.au and Domain.</p>
          </div>
          <ProductPreview />
        </section>

        <section id="why" className="bg-butter px-6 py-22">
          <div className={SPLIT}>
            <div className="flex flex-col gap-4">
              <h2 className={HEADING}>One home can be perfect for you and wrong for someone else.</h2>
              <p className="max-w-xl text-body">
                Morning coffee on foot, a good local school, quiet nights in: tell us what home means to
                you, and your match score reflects it. Pick a buyer and watch the needle move.
              </p>
            </div>
            <BuyerScores />
          </div>
        </section>

        <section className="px-6 py-22">
          <div className={SPLIT}>
            <div className="flex flex-col gap-3.5 max-md:order-2">
              {HEADS_UPS.map((item) => (
                <HeadsUp key={item.title} {...item} />
              ))}
            </div>
            <div className="flex flex-col gap-4">
              <h2 className={HEADING}>Fall in love with your eyes open.</h2>
              <p className="max-w-xl text-body">
                If something might be a dealbreaker for you, we&apos;ll gently let you know early, before
                your heart is set. A dealbreaker pulls the needle down, and we&apos;ll always tell you why.
              </p>
            </div>
          </div>
        </section>

        <section className="bg-forest px-6 py-22 text-cream">
          <div className={SPLIT}>
            <div className="flex flex-col gap-4">
              <h2 className={`${HEADING} text-gold-light`}>Like a friend who knows the area, right beside you.</h2>
              <p className="max-w-xl">
                As you browse realestate.com.au or Domain, the extension sits alongside the listing.
                Glance at your score, then open it up to see the answers behind it. No extra tabs, no
                digging.
              </p>
            </div>
            <div className="flex flex-col gap-3.5 rounded-3xl bg-cream p-6 text-ink">
              <div className="flex items-center gap-4">
                <Gauge score={82} decorative className="block w-31 flex-none" />
                <div>
                  <div className="font-display text-2xl leading-tight font-semibold">Why it&apos;s an 82</div>
                  <div className="text-sm text-muted">Example breakdown</div>
                </div>
              </div>
              {ANSWERS.map((item) => (
                <div key={item.question} className="border-t border-sand pt-3">
                  <strong>{item.question}</strong>
                  <p className="text-base text-body">{item.answer}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-22">
          <h2 className={HEADING}>Three easy steps to feeling sure</h2>
          <ol className="grid gap-8 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex flex-col gap-2">
                <span className="font-display text-5xl leading-none font-semibold text-gold-deep">{index + 1}</span>
                <h3 className="text-2xl font-bold">{step.title}</h3>
                <p className="text-body">{step.detail}</p>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl bg-butter px-6 py-5 text-base">
            <strong>Reading the needle</strong>
            {SCORE_KEY.map((item) => (
              <span key={item.label} className="flex items-center gap-2">
                <span className={`size-4 rounded-full ${item.className}`} />
                {item.label}
              </span>
            ))}
          </div>
          <Link href="/how-it-works" className="self-start font-bold text-forest underline hover:text-gold-deep">
            See the full quiz map and how your score is worked out
          </Link>
        </section>

        <section id="get" className="px-6 pb-22">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-4.5 rounded-[28px] bg-butter p-9 text-center md:p-16">
            <h2 className={HEADING}>Your next home is out there.</h2>
            <p className="max-w-xl text-body">
              Bring a friend along for the search. We only ever read the address of the home you&apos;re
              viewing, and there&apos;s no account to create.
            </p>
            <a href={INSTALL_URL} className={`${GOLD_BUTTON} px-7 py-3.5`}>Get the Chrome extension</a>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
