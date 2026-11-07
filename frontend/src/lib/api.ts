// Types follow docs/API_CONTRACT.md.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api";

export type Profile = {
  version: number;
  buyer_type: string;
  budget_max: number;
  household: string;
  min_bedrooms: number;
  vibe: string;
  commute_modes: string[];
  must_haves: string[];
  weights: { lifestyle: number; price: number; safety: number };
};

export type Factor = {
  key: string;
  label: string;
  value: string;
  score: number;
  impact: "positive" | "neutral" | "negative";
  detail: string;
  source: string;
};

export type Pillar = {
  key: "lifestyle" | "price" | "safety";
  label: string;
  score: number;
  weight: number;
  summary: string;
  factors: Factor[];
};

export type Candidate = { gnaf_id: string; address: string; property_type: string };

export type MatchResponse =
  | {
      status: "matched";
      query: string | null;
      property: {
        gnaf_id: string;
        address: string;
        suburb: string;
        dwelling_type: string | null;
        bed_count: number | null;
        bath_count: number | null;
        parking_count: number | null;
        land_area_sqm: number | null;
      };
      match: {
        overall: number;
        label: string;
        summary: string;
        pillars: Pillar[];
        dealbreakers: { key: string; message: string }[];
      };
      data_gaps: string[];
    }
  | { status: "ambiguous" | "no_match"; query: string | null; candidates: Candidate[] }
  | { status: "out_of_area"; query: string | null; message: string }
  | { status: "error"; code: string; message: string };

export async function getMatch(body: {
  address?: string;
  gnaf_id?: string;
  profile: Profile | null;
}): Promise<MatchResponse> {
  const response = await fetch(`${API_BASE}/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}
