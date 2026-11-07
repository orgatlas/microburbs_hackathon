"use client";

import { useRef } from "react";

import {
  CHAPTERS,
  FLOW_ARROWS,
  FLOW_CARDS,
  FLOW_HEIGHT,
  FLOW_LABELS,
  FLOW_LINES,
  FLOW_SHORTCUTS,
  FLOW_WIDTH,
  type FlowCard,
} from "@/lib/quizFlow";

const CARD_STYLES = {
  default: "border border-sand bg-paper text-ink",
  start: "bg-forest text-paper",
  final: "border-2 border-gold bg-paper text-ink",
  end: "bg-forest text-paper",
};

function Card({ card }: { card: FlowCard }) {
  return (
    <article
      className={`absolute h-[250px] w-80 overflow-hidden rounded-xl px-3.5 py-3 text-sm leading-5 ${CARD_STYLES[card.kind ?? "default"]}`}
      style={{ left: card.left, top: card.top }}
    >
      <h3 className="mb-2.5 text-base leading-snug font-bold">
        {card.kind === "end" ? card.title : `${card.id}. ${card.title}`}
      </h3>
      <ul className="flex flex-col gap-1">
        {card.answers.map((answer) => (
          <li key={answer.label}>
            <strong>{answer.label}:</strong> {answer.effect}
          </li>
        ))}
      </ul>
      {card.note && <p className="mt-2.5">{card.note}</p>}
    </article>
  );
}

export function QuizFlow() {
  const scroller = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Jump to a chapter">
        {CHAPTERS.map((chapter, index) => (
          <button
            key={chapter.title}
            type="button"
            onClick={() => scroller.current?.scrollTo({ left: chapter.left - 24, behavior: "smooth" })}
            className="min-h-11 cursor-pointer rounded-full border-2 border-forest px-4 py-2 text-base font-bold text-forest hover:bg-butter"
          >
            {index + 1}. {chapter.title}
          </button>
        ))}
      </div>
      <div
        ref={scroller}
        tabIndex={0}
        role="region"
        aria-label="Quiz flow diagram. Scroll sideways to follow the chapters."
        className="overflow-x-auto rounded-3xl border border-sand bg-cream"
      >
        <div className="relative" style={{ width: FLOW_WIDTH, height: FLOW_HEIGHT }}>
          {CHAPTERS.map((chapter, index) => (
            <div
              key={chapter.title}
              className={`absolute top-6 rounded-[20px] ${index % 2 ? "bg-[#f3f1de]" : "bg-butter"}`}
              style={{ left: chapter.left, width: chapter.width, height: 1540 }}
            >
              <p className="font-display px-6 pt-4 text-[22px] leading-7 font-semibold">
                Chapter {index + 1}: {chapter.title}
              </p>
            </div>
          ))}
          <svg
            className="absolute inset-0"
            width={FLOW_WIDTH}
            height={FLOW_HEIGHT}
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <defs>
              <marker id="flow-head" orient="auto" markerWidth="5" markerHeight="5" refX="2" refY="2">
                <path d="M0 0 L4 2 L0 4 Z" fill="#1f5a41" />
              </marker>
              <marker id="flow-head-gold" orient="auto" markerWidth="5" markerHeight="5" refX="2" refY="2">
                <path d="M0 0 L4 2 L0 4 Z" fill="#8a6410" />
              </marker>
            </defs>
            <g stroke="#1f5a41">
              {FLOW_LINES.map((path) => (
                <path key={path} d={path} />
              ))}
              {FLOW_ARROWS.map((path) => (
                <path key={path} d={path} markerEnd="url(#flow-head)" />
              ))}
            </g>
            <g stroke="#8a6410" strokeDasharray="6 6">
              {FLOW_SHORTCUTS.map((path) => (
                <path key={path} d={path} markerEnd="url(#flow-head-gold)" />
              ))}
            </g>
          </svg>
          {FLOW_CARDS.map((card) => (
            <Card key={card.id} card={card} />
          ))}
          {FLOW_LABELS.map((label) => (
            <p
              key={label.text}
              className={`absolute text-center text-[13px] leading-4 font-semibold ${label.className}`}
              style={{ left: label.left, top: label.top, width: label.width }}
            >
              {label.text}
            </p>
          ))}
        </div>
      </div>
      <p className="text-base text-body">
        <strong className="text-forest">Solid line:</strong> usual route.{" "}
        <strong className="text-gold-deep">Dashed line:</strong> a shortcut based on an earlier answer. Points:
        +12 strong, +8 clear, +4 mild, −4 matters less. Scroll sideways to follow the story.
      </p>
    </div>
  );
}
