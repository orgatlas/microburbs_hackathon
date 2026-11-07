"use client";

import { useState } from "react";

import { Gauge } from "@/components/Gauge";
import { ScoreBar } from "@/components/ScoreBar";

// Invented example scores for marketing. These are not API output.
const BUYERS = [
  {
    name: "First-home couple",
    overall: 82,
    label: "Strong match",
    note: "Everything you asked for is a short walk away, and it sits inside your budget.",
    pillars: { lifestyle: 91, price: 78, safety: 72 },
  },
  {
    name: "Young family",
    overall: 58,
    label: "Mixed match",
    note: "A lovely street, but the schools you care about are a longer trip.",
    pillars: { lifestyle: 52, price: 64, safety: 61 },
  },
  {
    name: "Investor",
    overall: 74,
    label: "Good match",
    note: "People love renting here, and the estimated value looks fair.",
    pillars: { lifestyle: 70, price: 81, safety: 68 },
  },
];

export function BuyerScores() {
  const [selected, setSelected] = useState(BUYERS[0]);

  return (
    <div className="flex flex-col gap-5 rounded-3xl bg-paper p-7">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Choose a buyer">
        {BUYERS.map((buyer) => {
          const isSelected = buyer.name === selected.name;
          return (
            <button
              key={buyer.name}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setSelected(buyer)}
              className={`min-h-11 cursor-pointer rounded-full border-2 border-forest px-4 py-2 text-base font-bold ${
                isSelected ? "bg-forest text-white" : "text-forest hover:bg-butter"
              }`}
            >
              {buyer.name}
            </button>
          );
        })}
      </div>
      <Gauge score={selected.overall} className="mx-auto block w-full max-w-96" />
      <div aria-live="polite" className="flex flex-col gap-3 text-center">
        <div>
          <div className="font-display text-7xl leading-none font-semibold">{selected.overall}</div>
          <div className="text-xl font-bold text-forest">{selected.label}</div>
        </div>
        <p className="text-body">{selected.note}</p>
      </div>
      <div className="flex flex-col gap-3 text-base">
        <ScoreBar label="Lifestyle & Community" score={selected.pillars.lifestyle} />
        <ScoreBar label="Price" score={selected.pillars.price} />
        <ScoreBar label="Safety" score={selected.pillars.safety} />
      </div>
      <p className="text-sm text-muted">Example scores for the same imagined home.</p>
    </div>
  );
}
