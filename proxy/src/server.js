// Local entry point. Loads proxy/.env then the repo-root .env (both optional; real env vars win),
// picks mock or live mode, and listens on 127.0.0.1:PORT. Never logs the key.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createLiveClient } from './client-live.js';
import { createMockClient } from './client-mock.js';
import { refreshSuburbs } from './suburbs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const proxyDir = path.resolve(here, '..');
const repoRoot = path.resolve(proxyDir, '..');

for (const file of [path.join(proxyDir, '.env'), path.join(repoRoot, '.env')]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // optional
  }
}

const PLACEHOLDER = 'paste-your-team-key-here';
const rawKey = (process.env.MICROBURBS_API_KEY || '').trim();
const apiKey = rawKey && rawKey !== PLACEHOLDER ? rawKey : '';
const mode = process.env.MOCK === '1' || !apiKey ? 'mock' : 'live';

const client =
  mode === 'live'
    ? createLiveClient({ apiKey, baseUrl: process.env.MICROBURBS_BASE_URL || 'https://api-ht.microburbs.com.au' })
    : createMockClient({ fixturesPath: path.join(proxyDir, 'fixtures', 'mock.json') });

const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || '127.0.0.1';

let suburbNote = 'static list (mock mode)';
if (mode === 'live') suburbNote = await refreshSuburbs(client);

const app = createApp({ client, mode });
app.listen(port, host, (err) => {
  if (err) {
    console.error(`microburbs proxy: could not listen on ${host}:${port} (${err.code || err.message})`);
    process.exit(1);
  }
  console.log(`microburbs proxy: mode=${mode} listening on http://${host}:${port} | suburbs: ${suburbNote}`);
});
