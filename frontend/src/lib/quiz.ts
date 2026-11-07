// The quiz tree and the weighting method from the How it works page.

export type Metric = "dist" | "pt" | "park" | "peak" | "live" | "amen" | "comm" | "val" | "dev" | "rates" | "afford";
export type Points = Record<Metric, number>;
export type Step = [node: string, answer: number];

type Answer = { label: string; points: Partial<Points>; next: string; flag?: string };
type Question = { chapter: number; title: string; answers: Answer[] };

export const METRIC_LABELS: Record<Metric, string> = {
  dist: "Distance",
  pt: "Public transport",
  park: "Parking",
  peak: "Peak busyness",
  live: "Liveability",
  amen: "Amenities",
  comm: "Community",
  val: "Value",
  dev: "Development",
  rates: "Council rates",
  afford: "Affordability",
};

const ARCHETYPES: Record<Metric, string> = {
  dist: "Short-Trip Seeker",
  pt: "Transit Regular",
  park: "Easy Parker",
  peak: "Traffic Dodger",
  live: "Liveability Lover",
  amen: "Everything-Nearby Local",
  comm: "Community Builder",
  val: "Value Hunter",
  dev: "Future Spotter",
  rates: "Cost Keeper",
  afford: "Budget Guardian",
};

export const CATEGORIES = [
  { key: "commuting", label: "Commuting", metrics: ["dist", "pt", "park", "peak"] as Metric[], bar: "bg-forest" },
  { key: "safety", label: "Safety", metrics: ["live", "amen", "comm"] as Metric[], bar: "bg-sage" },
  { key: "price", label: "Price", metrics: ["val", "dev", "rates", "afford"] as Metric[], bar: "bg-gold" },
];

export const CHAPTERS = ["Your story", "Getting around", "Your neighbourhood", "The money", "Your ending"];

const START_POINTS: Points = {
  dist: 12, pt: 12, park: 12, peak: 12, live: 16, amen: 16, comm: 16, val: 12, dev: 12, rates: 12, afford: 12,
};
const FLOOR = 4;

const a = (label: string, points: Partial<Points>, next: string, flag?: string): Answer => ({ label, points, next, flag });

export const QUIZ: Record<string, Question> = {
  Q1: { chapter: 0, title: "What's bringing you to the market?", answers: [
    a("My first place", {}, "F1"), a("Making room for kids", {}, "K1"),
    a("Slowing down or downsizing", {}, "D1"), a("Buying to rent out", {}, "I1", "investor")] },
  I1: { chapter: 0, title: "What's the goal for this property?", answers: [
    a("Steady rent", { afford: 8, val: 4 }, "I2"), a("Long-term growth", { dev: 12, val: 4 }, "I2"),
    a("Renovate and add value", { dev: 8, val: 8 }, "I2"), a("Live there one day", { val: 4 }, "F1")] },
  I2: { chapter: 0, title: "Who's your ideal tenant?", answers: [
    a("Students", { pt: 8, dist: 8 }, "M1"), a("Young professionals", { dist: 8, live: 4 }, "M1"),
    a("Families", { comm: 8, amen: 4 }, "M1")] },
  F1: { chapter: 0, title: "What's your week built around?", answers: [
    a("Study", { dist: 12, pt: 4 }, "F2", "study"), a("An office job", { dist: 8, peak: 4 }, "F2", "work"),
    a("Shifts at odd hours", { pt: 8, park: 4 }, "F2", "work"), a("Working from home", { amen: 8, dist: -4 }, "F2", "wfh")] },
  F2: { chapter: 0, title: "How tight will the budget be?", answers: [
    a("Every dollar counts", { afford: 12, rates: 4 }, "AFTER_F2"), a("Careful but comfortable", { val: 8, afford: 4 }, "AFTER_F2"),
    a("I'll pay for the right spot", { val: 4, live: 4 }, "AFTER_F2")] },
  K1: { chapter: 0, title: "How old are the kids?", answers: [
    a("Little ones", { live: 8, amen: 4 }, "K2"), a("School age", { comm: 8, amen: 4 }, "K3"),
    a("Teenagers", { pt: 8, comm: 4 }, "K3")] },
  K2: { chapter: 0, title: "What makes a good day with little ones?", answers: [
    a("A park nearby", { amen: 8 }, "G1"), a("Other families around", { comm: 12 }, "G1"),
    a("A quiet street", { peak: 8, live: 4 }, "G1")] },
  K3: { chapter: 0, title: "How does the school run work?", answers: [
    a("We walk", { amen: 8, dist: 4 }, "G4"), a("I drive them", { park: 8, peak: 8 }, "G2", "car"),
    a("They go on their own", { pt: 12 }, "G3")] },
  D1: { chapter: 0, title: "What are you happiest to leave behind?", answers: [
    a("All the upkeep", { rates: 8, afford: 4 }, "D2"), a("All the driving", { pt: 8, dist: 4 }, "D2"),
    a("Being too far from things", { amen: 8, live: 4 }, "D2")] },
  D2: { chapter: 0, title: "What do you want close by?", answers: [
    a("Shops and health care", { amen: 12 }, "G1"), a("Friends and family", { comm: 12 }, "G1"),
    a("Culture and good food", { live: 8, amen: 4 }, "G1")] },
  G1: { chapter: 1, title: "How do you mostly get around?", answers: [
    a("By car", { park: 4 }, "G2", "car"), a("Train, bus or ferry", { pt: 4 }, "G3"), a("On foot or by bike", { amen: 4 }, "G4")] },
  G2: { chapter: 1, title: "What's the worst part of driving?", answers: [
    a("Finding a park", { park: 12 }, "N1"), a("Peak-hour traffic", { peak: 12 }, "N1"), a("The long distance", { dist: 12 }, "N1")] },
  G3: { chapter: 1, title: "What makes a good trip?", answers: [
    a("A stop close to home", { pt: 12 }, "N1"), a("Getting there fast", { dist: 8, pt: 4 }, "N1"), a("Avoiding the crush", { peak: 8 }, "N1")] },
  G4: { chapter: 1, title: "How far is too far?", answers: [
    a("Ten minutes on foot", { amen: 8, dist: 4 }, "N1"), a("Twenty minutes is fine", { amen: 4, pt: 4 }, "N1"), a("I'll just ride", { dist: 4, park: -4 }, "N1")] },
  N1: { chapter: 2, title: "What's your perfect Saturday?", answers: [
    a("Cafes and markets", { amen: 8, live: 4 }, "N2"), a("Chatting with neighbours", { comm: 8 }, "N3"),
    a("Peace and quiet", { live: 8 }, "N4"), a("Out of the area", { park: 4, amen: -4 }, "M1")] },
  N2: { chapter: 2, title: "How lively should it be?", answers: [
    a("Always buzzing", { amen: 8 }, "M1", "nightlife"), a("A happy balance", { amen: 4, live: 4 }, "M1"), a("Busy by day, calm by night", { live: 4, peak: 4 }, "M1")] },
  N3: { chapter: 2, title: "Who would you love as neighbours?", answers: [
    a("People at my stage of life", { comm: 12 }, "M1"), a("A mix of ages", { comm: 4, live: 4 }, "M1"), a("Long-term locals", { comm: 8 }, "M1")] },
  N4: { chapter: 2, title: "What would spoil the peace?", answers: [
    a("Traffic", { peak: 12 }, "M1"), a("Building work nearby", { dev: 12 }, "M1", "less-development"), a("Crowds at night", { live: 8 }, "M1")] },
  M1: { chapter: 3, title: "What worries you most about the money?", answers: [
    a("The repayments", { afford: 12 }, "M2"), a("Paying too much", { val: 12 }, "M3"),
    a("Ongoing costs", { rates: 12, afford: 4 }, "T1"), a("What's coming to the area", { dev: 12, val: 4 }, "M4")] },
  M2: { chapter: 3, title: "If the budget ran short, what would you do?", answers: [
    a("Go further out", { afford: 8, dist: -4 }, "T1"), a("Go smaller", { afford: 8 }, "T1"), a("Stretch for the right place", { live: 4, amen: 4 }, "T1")] },
  M3: { chapter: 3, title: "How do you judge a fair price?", answers: [
    a("Against nearby sales", { val: 8 }, "T1"), a("By where prices are heading", { val: 4, dev: 4 }, "T1"), a("Love matters more", { live: 4, val: -4 }, "T1")] },
  M4: { chapter: 3, title: "How do you feel about new development?", answers: [
    a("Bring it on", { dev: 8 }, "T1", "more-development"), a("Some is fine", { dev: 4 }, "T1"), a("Keep it as it is", { dev: 8, live: 4 }, "T1", "less-development")] },
  T1: { chapter: 4, title: "If you could only keep one, which would it be?", answers: [
    a("Easy trips", { dist: 6, pt: 6, park: 6, peak: 6 }, "DETAILS"), a("Feeling at home", { live: 8, amen: 8, comm: 8 }, "DETAILS"),
    a("Sensible money", { val: 6, dev: 6, rates: 6, afford: 6 }, "DETAILS"), a("I want a balance", {}, "DETAILS")] },
};

const answerOf = ([node, index]: Step) => QUIZ[node].answers[index];

export function flagsOf(trail: Step[]) {
  return trail.map((step) => answerOf(step).flag).filter((flag): flag is string => Boolean(flag));
}

export function nextNode(trail: Step[]) {
  const next = answerOf(trail[trail.length - 1]).next;
  if (next === "AFTER_F2") return flagsOf(trail).includes("wfh") ? "N1" : "G1";
  return next;
}

export function weightsOf(trail: Step[]): Points {
  const points = { ...START_POINTS };
  for (const step of trail) {
    for (const [metric, value] of Object.entries(answerOf(step).points)) {
      points[metric as Metric] += value;
    }
  }
  const metrics = Object.keys(points) as Metric[];
  for (const metric of metrics) points[metric] = Math.max(FLOOR, points[metric]);
  const total = metrics.reduce((sum, metric) => sum + points[metric], 0);
  for (const metric of metrics) points[metric] /= total;
  return points;
}

export function categoriesOf(weights: Points) {
  return Object.fromEntries(
    CATEGORIES.map((category) => [category.key, category.metrics.reduce((sum, metric) => sum + weights[metric], 0)]),
  ) as Record<string, number>;
}

export function archetypeOf(weights: Points) {
  const metrics = Object.keys(weights) as Metric[];
  return ARCHETYPES[metrics.reduce((best, metric) => (weights[metric] > weights[best] ? metric : best))];
}

export function topMetricOf(weights: Points) {
  const metrics = Object.keys(weights) as Metric[];
  return METRIC_LABELS[metrics.reduce((best, metric) => (weights[metric] > weights[best] ? metric : best))];
}

export function learnedFrom(trail: Step[]) {
  if (!trail.length) return "Pick the answer that feels most like you. There are no wrong turns.";
  const gained = Object.entries(answerOf(trail[trail.length - 1]).points)
    .filter(([, value]) => value > 0)
    .map(([metric]) => METRIC_LABELS[metric as Metric]);
  if (!gained.length) return "Got it. Let's see where your story goes.";
  return `Noted. We'll give more weight to ${gained.join(" and ")}.`;
}

export function reasonsFrom(trail: Step[]) {
  return trail
    .filter(([node]) => node !== "T1")
    .map((step) => {
      const answer = answerOf(step);
      return { label: answer.label, strength: Object.values(answer.points).reduce((sum, value) => sum + Math.max(0, value), 0) };
    })
    .sort((one, two) => two.strength - one.strength)
    .slice(0, 3)
    .map((item) => item.label);
}

export type Details = { mode: "buy" | "rent"; budget: number; income: number | null; address: string };

// The side panel reads four weights (README Contract 1). Commute and Price match our categories.
// Liveability carries Microburbs' safety score, and Amenities and Community are its lifestyle signals.
export function extensionProfile(name: string, weights: Points, details: Details, trail: Step[]) {
  const flags = flagsOf(trail);
  const categories = categoriesOf(weights);
  const budget = details.mode === "buy" ? { budgetPrice: details.budget } : { budgetWeekly: details.budget };
  return {
    name,
    mode: details.mode,
    ...budget,
    ...(details.income ? { incomeWeekly: details.income } : {}),
    ...(details.address ? { workAddress: details.address } : {}),
    hasCar: flags.includes("car"),
    nightlife: flags.includes("nightlife"),
    metricWeights: weights,
    weights: {
      commute: categories.commuting,
      safety: weights.live,
      lifestyle: weights.amen + weights.comm,
      price: categories.price,
    },
  };
}

export const percent = (share: number) => `${Math.round(share * 1000) / 10}%`;
