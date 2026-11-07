import type { Metadata } from "next";

import { QuizFlow } from "@/components/QuizFlow";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

export const metadata: Metadata = {
  title: "How it works: MicroMatch",
  description: "How the MicroMatch quiz learns what matters to you, and how each answer becomes a match score.",
};

const HEADING = "font-display text-3xl leading-tight font-semibold md:text-4xl";
const SECTION = "mx-auto flex max-w-6xl flex-col gap-5 px-6 py-12";
const CELL = "border-b border-sand px-3 py-2.5 align-top";

const METHOD_STEPS = [
  {
    title: "Start equal",
    detail: "Each category starts with 48 points, or one third. Commuting and Price split that into 12 per metric. Safety has three metrics, so 16 each.",
  },
  {
    title: "Answers add points",
    detail: "+4 is mild, +8 is clear and +12 is strong, which doubles a 12-point metric. −4 means it matters less. No metric falls below 4 points.",
  },
  {
    title: "Final choice",
    detail: "The last question adds 24 points to one category, shared across its metrics. That's half its starting total. \"I want a balance\" adds nothing.",
  },
  {
    title: "Convert to weights",
    detail: "Metric weight = metric points ÷ all points. The 11 weights always add to 100%, however many questions a person answered.",
  },
  {
    title: "Score the home",
    detail: "Each metric gets 0 to 100 from the API. Weights then roll up to category scores and the overall score. Missing data is left out, and the rest are rebalanced.",
  },
];

const FORMULAS = [
  { title: "Metric weight", formula: "w = points ÷ total points" },
  { title: "Category score", formula: "Σ(w × score) ÷ Σ(w), within the category" },
  { title: "Overall score", formula: "Σ(w × score), across all 11 metrics" },
];

const EXAMPLE = [
  {
    category: "Commuting", share: "31.1%", score: 55,
    rows: [
      ["Distance", 12, "None", 12, "4.9%", 80],
      ["Public transport", 12, "None", 12, "4.9%", 70],
      ["Parking", 12, "+8 drives them", 20, "8.2%", 40],
      ["Peak busyness", 12, "+8 drives them, +12 traffic", 32, "13.1%", 50],
    ],
  },
  {
    category: "Safety", share: "42.6%", score: 70,
    rows: [
      ["Liveability", 16, "+8 final choice", 24, "9.8%", 75],
      ["Amenities", 16, "+4 school age, +8 final choice", 28, "11.5%", 85],
      ["Community", 16, "+8 school age, +8 neighbours, +12 same stage, +8 final choice", 52, "21.3%", 60],
    ],
  },
  {
    category: "Price", share: "26.2%", score: 60,
    rows: [
      ["Value", 12, "None", 12, "4.9%", 65],
      ["Development", 12, "None", 12, "4.9%", 55],
      ["Council rates", 12, "+12 ongoing costs", 24, "9.8%", 70],
      ["Affordability", 12, "+4 ongoing costs", 16, "6.6%", 45],
    ],
  },
];

const METRICS = [
  ["Commuting", "Distance to work, uni, CBD", "/suburbs/{s}/lifestyle/cbd, plus your address", "Straight-line distance from the home"],
  ["Commuting", "Public transport", "/properties/{id}/transport/nearby", "Nearest stop for the modes you use"],
  ["Commuting", "Parking", "/properties/{id}/basics/parking-count", "Car spaces at the home"],
  ["Commuting", "Peak busyness", "/suburbs/{s}/shapes/busy-roads", "Distance to a busy road. This is a stand-in, as the API has no peak-hour data"],
  ["Safety", "Liveability", "/suburbs/{s}/lifestyle/livability", "Microburbs livability scores, including its safety score"],
  ["Safety", "Amenities", "/properties/{id}/amenities/nearby", "Supermarkets, green space and restaurants nearby"],
  ["Safety", "Community", "/suburbs/{s}/demographics/age", "Share of residents at your stage of life"],
  ["Price", "Value", "/properties/{id}/valuation/avm", "Estimated value and range against your budget"],
  ["Price", "Development", "/suburbs/{s}/development/applications", "Recent activity, read as good or bad using your preference"],
  ["Price", "Council rates", "/suburbs/{s}/development/council-rates", "Average annual rates"],
  ["Price", "Affordability", "/suburbs/{s}/market/affordability", "Microburbs affordability index"],
];

const TESTS = [
  { title: "No category is favoured", detail: "Average weights across all paths: Commuting 31.9%, Safety 33.5%, Price 34.5%." },
  { title: "Answers really change it", detail: "Category weights range from 17.5% to 55.0%, and the paths produce 114,986 different profiles." },
  { title: "Nothing takes over", detail: "The largest single metric weight on any path is 30.6%, and every metric keeps some weight." },
];

export default function HowItWorks() {
  return (
    <div className="text-lg leading-relaxed">
      <SiteHeader />
      <main>
        <section className="mx-auto flex max-w-6xl flex-col gap-4 px-6 pt-10 pb-6">
          <h1 className="font-display text-5xl leading-[1.05] font-semibold tracking-tight lg:text-6xl">
            How a quiz answer becomes a score
          </h1>
          <p className="max-w-3xl text-xl text-body">
            Like a choose-your-own-adventure book, each answer decides the next question. There are 23 questions
            and 117,960 possible paths, and you&apos;ll answer between 5 and 11 of them.
          </p>
        </section>

        <section aria-labelledby="map" className={SECTION}>
          <h2 id="map" className={HEADING}>The quiz map</h2>
          <QuizFlow />
        </section>

        <section aria-labelledby="method" className={SECTION}>
          <h2 id="method" className={HEADING}>The method</h2>
          <p className="max-w-4xl text-body">
            MicroMatch uses a weighted-sum model, the standard method in multi-criteria decision analysis. People
            struggle to give honest percentages, so the quiz works out your weights from everyday choices. Every
            point can be traced to one answer.
          </p>
          <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {METHOD_STEPS.map((step, index) => (
              <li key={step.title} className="rounded-2xl border border-sand bg-paper p-4.5 text-base">
                <h3 className="text-lg font-bold">{index + 1}. {step.title}</h3>
                <p>{step.detail}</p>
              </li>
            ))}
          </ol>
          <dl className="grid gap-6 rounded-2xl bg-forest px-7 py-6 text-paper md:grid-cols-3">
            {FORMULAS.map((item) => (
              <div key={item.title}>
                <dt className="font-bold text-gold-light">{item.title}</dt>
                <dd className="text-xl">{item.formula}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="example" className={SECTION}>
          <h2 id="example" className={HEADING}>The weighting, worked through</h2>
          <p className="max-w-4xl text-body">
            A parent of school-age kids takes this path: Making room for kids → School age → I drive them →
            Peak-hour traffic → Chatting with neighbours → People at my stage of life → Ongoing costs → Feeling at
            home. The metric scores are invented to show the calculation.
          </p>
          <div tabIndex={0} role="region" aria-label="Worked example table" className="overflow-x-auto rounded-2xl bg-paper">
            <table className="w-full min-w-[820px] border-collapse text-left text-base">
              <thead className="text-sm text-body">
                <tr>
                  {["Metric", "Start", "Added by answers", "Points", "Weight", "Example score"].map((heading) => (
                    <th key={heading} scope="col" className={CELL}>{heading}</th>
                  ))}
                </tr>
              </thead>
              {EXAMPLE.map((group) => (
                <tbody key={group.category}>
                  <tr className="bg-butter">
                    <th colSpan={6} scope="colgroup" className={CELL}>
                      {group.category}: {group.share} of the total, category score {group.score}
                    </th>
                  </tr>
                  {group.rows.map(([metric, start, added, points, weight, score]) => (
                    <tr key={metric}>
                      <td className={CELL}>{metric}</td>
                      <td className={CELL}>{start}</td>
                      <td className={CELL}>{added}</td>
                      <td className={CELL}>{points}</td>
                      <td className={CELL}>{weight}</td>
                      <td className={CELL}>{score}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
          <p className="text-2xl">
            <strong>Overall match: 63</strong>{" "}
            <span className="text-base text-body">(15,340 weighted points ÷ 244 total points)</span>
          </p>
        </section>

        <section aria-labelledby="metrics" className={SECTION}>
          <h2 id="metrics" className={HEADING}>Where each metric comes from</h2>
          <div tabIndex={0} role="region" aria-label="Metric sources table" className="overflow-x-auto rounded-2xl bg-paper">
            <table className="w-full min-w-[820px] border-collapse text-left text-base">
              <thead className="text-sm text-body">
                <tr>
                  {["Category", "Metric", "API endpoint", "What it measures"].map((heading) => (
                    <th key={heading} scope="col" className={CELL}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map(([category, metric, endpoint, measure]) => (
                  <tr key={metric}>
                    <td className={CELL}>{category}</td>
                    <td className={CELL}>{metric}</td>
                    <td className={`${CELL} font-mono text-sm`}>{endpoint}</td>
                    <td className={CELL}>{measure}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="testing" className={`${SECTION} pb-20`}>
          <h2 id="testing" className={HEADING}>Testing all 117,960 paths</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {TESTS.map((test) => (
              <div key={test.title} className="rounded-2xl bg-butter p-4.5 text-base">
                <h3 className="text-lg font-bold">{test.title}</h3>
                <p>{test.detail}</p>
              </div>
            ))}
          </div>
          <p className="max-w-4xl text-body">
            This shows the quiz is balanced and responsive. It doesn&apos;t show the point values are
            &quot;correct&quot;: they&apos;re our team&apos;s judgement, not fitted to buyer outcomes.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
