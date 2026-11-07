// Change to the deployed URL for the demo, and add it to host_permissions in manifest.json.
// The Microburbs key never lives in the extension: all data goes through the team backend.
// The team proxy (proxy/, README Contract 2): GET ${API_BASE}/lookup?address=&work=
export const API_BASE = "http://localhost:3000";

// Django holds accounts and saved quiz weights. The website is where the quiz is taken.
export const ACCOUNT_API = "http://localhost:8001/api";
export const SITE_URL = "http://localhost:3001";
