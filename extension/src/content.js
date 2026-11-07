// Sends the address to the service worker. Polls because both sites can change
// listing without a full page load.
let lastSent;

function check() {
  const address = findAddress(location.hostname, document);
  if (address === lastSent) return;
  lastSent = address;
  chrome.runtime.sendMessage({ type: "listing-address", address });
}

check();
setInterval(check, 1000);
