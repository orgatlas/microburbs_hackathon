// MicroMatch side panel: login, and loading the user's saved quiz weights from Django.
// The token and profile live in chrome.storage.local. score.js multiplies each signal by its weight.
// The password goes straight to Django and is never stored.
import { ACCOUNT_API, SITE_URL } from "../src/config.js";

const AUTH_KEY = "auth";
const part = (name) => document.querySelector(`[data-account="${name}"]`);

async function request(path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${ACCOUNT_API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const problem = new Error(data.message || "Something went wrong. Please try again.");
    problem.status = response.status;
    throw problem;
  }
  return data;
}

async function saveProfile(latestQuiz) {
  const next = latestQuiz ? { ...latestQuiz.extension_profile, metricWeights: latestQuiz.weights } : null;
  const { profile } = await chrome.storage.local.get("profile");
  if (JSON.stringify(profile ?? null) === JSON.stringify(next)) return;
  if (next) await chrome.storage.local.set({ profile: next });
  else await chrome.storage.local.remove("profile");
}

// The login card is only for people with no profile yet. A profile saved by the website (through
// site-bridge.js) or by logging in here hides it, so the score is what shows.
let hasProfile = false;
let lastAccount = null;

function show(account) {
  lastAccount = account;
  part("logged-out").hidden = Boolean(account) || hasProfile;
  part("logged-in").hidden = !account;
  if (!account) return;
  const quiz = account.latest_quiz;
  part("summary").textContent = quiz
    ? `Scored for ${account.user.name}, a ${quiz.archetype}`
    : `Hi ${account.user.name}. Take the quiz to personalise your score.`;
  part("quiz").textContent = quiz ? "Retake the quiz" : "Take the quiz";
}

async function sync() {
  const { [AUTH_KEY]: token, profile } = await chrome.storage.local.get([AUTH_KEY, "profile"]);
  hasProfile = Boolean(profile && typeof profile === "object");
  if (!token) return show(null);
  try {
    const account = await request("/me", { token });
    await saveProfile(account.latest_quiz);
    show(account);
  } catch (problem) {
    if (problem.status === 401) {
      await chrome.storage.local.remove([AUTH_KEY, "profile"]);
      show(null);
    }
    // If Django is unreachable, keep the last saved weights so scoring still works.
  }
}

async function logIn(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const error = part("error");
  error.hidden = true;
  try {
    const { token } = await request("/auth/login", {
      method: "POST",
      body: { email: form.get("email"), password: form.get("password") },
    });
    await chrome.storage.local.set({ [AUTH_KEY]: token });
    event.target.reset();
    await sync();
  } catch (problem) {
    error.textContent = problem.status ? problem.message : "We couldn't reach MicroMatch. Is Django running?";
    error.hidden = false;
  }
}

async function logOut() {
  const { [AUTH_KEY]: token } = await chrome.storage.local.get(AUTH_KEY);
  await request("/auth/logout", { method: "POST", body: {}, token }).catch(() => undefined);
  await chrome.storage.local.remove([AUTH_KEY, "profile"]);
  show(null);
}

export function initAccount() {
  part("signup").href = `${SITE_URL}/login`;
  part("quiz").href = `${SITE_URL}/dashboard`;
  part("logged-out").addEventListener("submit", logIn);
  part("logout").addEventListener("click", logOut);
  window.addEventListener("focus", sync); // picks up a retake made on the website
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !("profile" in changes)) return;
    hasProfile = Boolean(changes.profile.newValue && typeof changes.profile.newValue === "object");
    show(lastAccount);
  });
  sync();
}
