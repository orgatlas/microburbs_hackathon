// Runs only on the MicroMatch website. Copies the logged-in user's saved quiz profile into
// chrome.storage.local, where the side panel reads it (README Contract 1). It reads nothing else.
const respond = (type) => window.postMessage({ type }, location.origin);

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const { type, profile } = event.data || {};
  if (type === "micromatch:save-profile" && profile && typeof profile === "object") {
    chrome.storage.local.set({ profile }).then(() => respond("micromatch:profile-saved"));
  }
  if (type === "micromatch:clear-profile") chrome.storage.local.remove("profile");
});
