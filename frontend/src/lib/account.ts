"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { Points, Step, Details } from "@/lib/quiz";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8001/api";
const TOKEN_KEY = "micromatch.token";

export type User = { name: string; email: string };
export type QuizResult = {
  id: number;
  answers: Step[];
  weights: Points;
  categories: Record<string, number>;
  archetype: string;
  details: Details;
  extension_profile: Record<string, unknown>;
  created_at: string;
};
export type HistoryItem = Pick<QuizResult, "id" | "archetype" | "categories" | "created_at">;
export type Account = { user: User; latest_quiz: QuizResult | null; history: HistoryItem[] };

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = window.localStorage.getItem(TOKEN_KEY);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError("We couldn't reach MicroMatch. Please try again.", 0);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.message ?? "Something went wrong. Please try again.", response.status);
  return data;
}

export async function signUp(name: string, email: string, password: string) {
  const data = await request<{ token: string }>("/auth/register", { method: "POST", body: { name, email, password } });
  window.localStorage.setItem(TOKEN_KEY, data.token);
}

export async function logIn(email: string, password: string) {
  const data = await request<{ token: string }>("/auth/login", { method: "POST", body: { email, password } });
  window.localStorage.setItem(TOKEN_KEY, data.token);
}

export async function logOut() {
  await request("/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
  window.localStorage.removeItem(TOKEN_KEY);
  window.postMessage({ type: "micromatch:clear-profile" }, window.location.origin);
}

export function saveQuiz(result: Omit<QuizResult, "id" | "created_at">) {
  return request<QuizResult>("/quiz-results", { method: "POST", body: result });
}

// The extension's site-bridge content script answers on this page. No reply means it isn't installed.
export function sendProfileToExtension(profile: Record<string, unknown>) {
  return new Promise<boolean>((resolve) => {
    let attempts = 0;
    const send = () => window.postMessage({ type: "micromatch:save-profile", profile }, window.location.origin);
    const finish = (saved: boolean) => {
      window.clearInterval(timer);
      window.removeEventListener("message", listen);
      resolve(saved);
    };
    const listen = (event: MessageEvent) => {
      if (event.source === window && event.data?.type === "micromatch:profile-saved") finish(true);
    };
    const timer = window.setInterval(() => {
      attempts += 1;
      if (attempts >= 4) finish(false);
      else send();
    }, 400);
    window.addEventListener("message", listen);
    send();
  });
}

// Loads the logged-in account, or sends the visitor to the login page.
export function useAccount() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    let active = true;
    request<Account>("/me")
      .then((data) => {
        if (active) setAccount(data);
      })
      .catch((problem: ApiError) => {
        if (!active) return;
        if (problem.status === 401) {
          window.localStorage.removeItem(TOKEN_KEY);
          router.replace("/login");
        } else {
          setFailed(problem.message);
        }
      });
    return () => {
      active = false;
    };
  }, [router]);

  return { account, failed };
}

export function useIsLoggedIn() {
  const [loggedIn, setLoggedIn] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setLoggedIn(Boolean(window.localStorage.getItem(TOKEN_KEY))), 0);
    return () => window.clearTimeout(timer);
  }, []);
  return loggedIn;
}
