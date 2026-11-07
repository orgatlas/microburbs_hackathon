// The quiz map. Positions are in pixels on the flow diagram's fixed-size canvas.

export const FLOW_WIDTH = 5112;
export const FLOW_HEIGHT = 1600;

export type FlowCard = {
  id: string;
  title: string;
  left: number;
  top: number;
  kind?: "start" | "final" | "end";
  answers: { label: string; effect: string }[];
  note?: string;
};

export const CHAPTERS = [
  { title: "Your story", left: 64, width: 1312 },
  { title: "Getting around", left: 1436, width: 850 },
  { title: "Your neighbourhood", left: 2356, width: 850 },
  { title: "The money", left: 3276, width: 850 },
  { title: "Your ending", left: 4196, width: 852 },
];

export const FLOW_CARDS: FlowCard[] = [
  {
    id: "Q1", title: "What's bringing you to the market?", left: 96, top: 525, kind: "start",
    answers: [
      { label: "My first place", effect: "→ F1" },
      { label: "Making room for kids", effect: "→ K1" },
      { label: "Slowing down or downsizing", effect: "→ D1" },
      { label: "Buying to rent out", effect: "→ I1" },
    ],
    note: "No points: this only picks your story.",
  },
  {
    id: "I1", title: "What's the goal for this property?", left: 556, top: 90,
    answers: [
      { label: "Steady rent", effect: "Affordability +8, Value +4" },
      { label: "Long-term growth", effect: "Development +12, Value +4" },
      { label: "Renovate and add value", effect: "Development +8, Value +8" },
      { label: "Live there one day", effect: "Value +4 → F1" },
    ],
  },
  {
    id: "F1", title: "What's your week built around?", left: 556, top: 380,
    answers: [
      { label: "Study", effect: "Distance +12, Transport +4" },
      { label: "An office job", effect: "Distance +8, Peak +4" },
      { label: "Shifts at odd hours", effect: "Transport +8, Parking +4" },
      { label: "Working from home", effect: "Amenities +8, Distance −4" },
    ],
  },
  {
    id: "D1", title: "What are you happiest to leave behind?", left: 556, top: 670,
    answers: [
      { label: "All the upkeep", effect: "Rates +8, Affordability +4" },
      { label: "All the driving", effect: "Transport +8, Distance +4" },
      { label: "Being too far from things", effect: "Amenities +8, Liveability +4" },
    ],
  },
  {
    id: "K1", title: "How old are the kids?", left: 556, top: 1105,
    answers: [
      { label: "Little ones", effect: "Liveability +8, Amenities +4 → K2" },
      { label: "School age", effect: "Community +8, Amenities +4 → K3" },
      { label: "Teenagers", effect: "Transport +8, Community +4 → K3" },
    ],
  },
  {
    id: "I2", title: "Who's your ideal tenant?", left: 1016, top: 90,
    answers: [
      { label: "Students", effect: "Transport +8, Distance +8" },
      { label: "Young professionals", effect: "Distance +8, Liveability +4" },
      { label: "Families", effect: "Community +8, Amenities +4" },
    ],
  },
  {
    id: "F2", title: "How tight will the budget be?", left: 1016, top: 380,
    answers: [
      { label: "Every dollar counts", effect: "Affordability +12, Rates +4" },
      { label: "Careful but comfortable", effect: "Value +8, Affordability +4" },
      { label: "I'll pay for the right spot", effect: "Value +4, Liveability +4" },
    ],
  },
  {
    id: "D2", title: "What do you want close by?", left: 1016, top: 670,
    answers: [
      { label: "Shops and health care", effect: "Amenities +12" },
      { label: "Friends and family", effect: "Community +12" },
      { label: "Culture and good food", effect: "Liveability +8, Amenities +4" },
    ],
  },
  {
    id: "K2", title: "What makes a good day with little ones?", left: 1016, top: 960,
    answers: [
      { label: "A park nearby", effect: "Amenities +8" },
      { label: "Other families around", effect: "Community +12" },
      { label: "A quiet street", effect: "Peak +8, Liveability +4" },
    ],
  },
  {
    id: "K3", title: "How does the school run work?", left: 1016, top: 1250,
    answers: [
      { label: "We walk", effect: "Amenities +8, Distance +4 → G4" },
      { label: "I drive them", effect: "Parking +8, Peak +8 → G2" },
      { label: "They go on their own", effect: "Transport +12 → G3" },
    ],
  },
  {
    id: "G1", title: "How do you mostly get around?", left: 1476, top: 525,
    answers: [
      { label: "By car", effect: "Parking +4 → G2" },
      { label: "Train, bus or ferry", effect: "Transport +4 → G3" },
      { label: "On foot or by bike", effect: "Amenities +4 → G4" },
    ],
  },
  {
    id: "G2", title: "What's the worst part of driving?", left: 1936, top: 235,
    answers: [
      { label: "Finding a park", effect: "Parking +12" },
      { label: "Peak-hour traffic", effect: "Peak +12" },
      { label: "The long distance", effect: "Distance +12" },
    ],
  },
  {
    id: "G3", title: "What makes a good trip?", left: 1936, top: 525,
    answers: [
      { label: "A stop close to home", effect: "Transport +12" },
      { label: "Getting there fast", effect: "Distance +8, Transport +4" },
      { label: "Avoiding the crush", effect: "Peak +8" },
    ],
  },
  {
    id: "G4", title: "How far is too far?", left: 1936, top: 815,
    answers: [
      { label: "Ten minutes on foot", effect: "Amenities +8, Distance +4" },
      { label: "Twenty minutes is fine", effect: "Amenities +4, Transport +4" },
      { label: "I'll just ride", effect: "Distance +4, Parking −4" },
    ],
  },
  {
    id: "N1", title: "What's your perfect Saturday?", left: 2396, top: 525,
    answers: [
      { label: "Cafes and markets", effect: "Amenities +8, Liveability +4 → N2" },
      { label: "Chatting with neighbours", effect: "Community +8 → N3" },
      { label: "Peace and quiet", effect: "Liveability +8 → N4" },
      { label: "Out of the area", effect: "Parking +4, Amenities −4 → M1" },
    ],
  },
  {
    id: "N2", title: "How lively should it be?", left: 2856, top: 235,
    answers: [
      { label: "Always buzzing", effect: "Amenities +8" },
      { label: "A happy balance", effect: "Amenities +4, Liveability +4" },
      { label: "Busy by day, calm by night", effect: "Liveability +4, Peak +4" },
    ],
  },
  {
    id: "N3", title: "Who would you love as neighbours?", left: 2856, top: 525,
    answers: [
      { label: "People at my stage of life", effect: "Community +12" },
      { label: "A mix of ages", effect: "Community +4, Liveability +4" },
      { label: "Long-term locals", effect: "Community +8" },
    ],
  },
  {
    id: "N4", title: "What would spoil the peace?", left: 2856, top: 815,
    answers: [
      { label: "Traffic", effect: "Peak +12" },
      { label: "Building work nearby", effect: "Development +12, prefers less" },
      { label: "Crowds at night", effect: "Liveability +8" },
    ],
  },
  {
    id: "M1", title: "What worries you most about the money?", left: 3316, top: 525,
    answers: [
      { label: "The repayments", effect: "Affordability +12 → M2" },
      { label: "Paying too much", effect: "Value +12 → M3" },
      { label: "Ongoing costs", effect: "Rates +12, Affordability +4 → T1" },
      { label: "What's coming to the area", effect: "Development +12, Value +4 → M4" },
    ],
  },
  {
    id: "M2", title: "If the budget ran short, what would you do?", left: 3776, top: 235,
    answers: [
      { label: "Go further out", effect: "Affordability +8, Distance −4" },
      { label: "Go smaller", effect: "Affordability +8" },
      { label: "Stretch for the right place", effect: "Liveability +4, Amenities +4" },
    ],
  },
  {
    id: "M3", title: "How do you judge a fair price?", left: 3776, top: 525,
    answers: [
      { label: "Against nearby sales", effect: "Value +8" },
      { label: "By where prices are heading", effect: "Value +4, Development +4" },
      { label: "Love matters more", effect: "Liveability +4, Value −4" },
    ],
  },
  {
    id: "M4", title: "How do you feel about new development?", left: 3776, top: 815,
    answers: [
      { label: "Bring it on", effect: "Development +8, prefers more" },
      { label: "Some is fine", effect: "Development +4" },
      { label: "Keep it as it is", effect: "Development +8, prefers less, Liveability +4" },
    ],
  },
  {
    id: "T1", title: "If you could only keep one, which would it be?", left: 4236, top: 525, kind: "final",
    answers: [
      { label: "Easy trips", effect: "Commuting +24 in total" },
      { label: "Feeling at home", effect: "Safety +24 in total" },
      { label: "Sensible money", effect: "Price +24 in total" },
      { label: "I want a balance", effect: "no change" },
    ],
  },
  {
    id: "End", title: "Your profile is ready", left: 4696, top: 525, kind: "end",
    answers: [
      { label: "Your budget", effect: "no points" },
      { label: "Your work or uni address", effect: "no points" },
    ],
    note: "These let us score Affordability and Distance. Output: 11 metric weights, adding up to 100%.",
  },
];

// SVG path data for the diagram's lines.
export const FLOW_LINES = [
  "M416 650H486", "M486 215V1230", "M876 1230H946", "M946 1085V1375",
  "M1336 505H1406", "M1336 795H1406", "M1336 1085H1406", "M1406 505V1085",
  "M1336 1375H1866V360", "M1796 650H1866",
  "M2256 360H2326", "M2256 940H2326", "M2326 360V940", "M2786 360V940",
  "M3176 360H3246", "M3176 940H3246", "M3246 360V940", "M3706 360V940",
  "M4096 360H4166", "M4096 940H4166", "M4166 360V940",
];

export const FLOW_ARROWS = [
  "M486 215H553", "M486 505H553", "M486 795H553", "M486 1230H553",
  "M876 215H1013", "M876 505H1013", "M876 795H1013", "M946 1085H1013", "M946 1375H1013",
  "M1406 650H1473", "M1866 360H1933", "M1866 650H1933", "M1866 940H1933",
  "M2256 650H2393", "M2716 650H2853", "M2786 360H2853", "M2786 940H2853",
  "M3176 650H3313", "M3636 650H3773", "M3706 360H3773", "M3706 940H3773",
  "M4096 650H4233", "M4556 650H4693",
];

export const FLOW_SHORTCUTS = [
  "M716 340V378", "M1336 215H3476V523", "M1406 505H2556V523",
  "M2556 775V1085H3423V777", "M3530 775V1085H4396V777",
];

export const FLOW_LABELS = [
  { text: "Live there one day", left: 728, top: 352, width: 150, className: "text-gold-deep" },
  { text: "Investors skip to the money: tenant answers cover the rest", left: 2000, top: 187, width: 420, className: "text-gold-deep" },
  { text: "Works from home", left: 2396, top: 477, width: 150, className: "text-gold-deep" },
  { text: "The school run already tells us how they travel", left: 1440, top: 1347, width: 340, className: "text-forest" },
  { text: "Out of the area", left: 2680, top: 1097, width: 170, className: "text-gold-deep" },
  { text: "Ongoing costs", left: 3830, top: 1097, width: 170, className: "text-gold-deep" },
];
