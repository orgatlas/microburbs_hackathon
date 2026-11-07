import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createApp, loadConfig } from '../server.js';
import { createApiClient } from '../cache.js';

const address = 'Unit 105, 8 Sam Sing Street, Waterloo';
const work = 'Broadway, Ultimo NSW';
const env = loadConfig();
const apiKey = env.MICROBURBS_API_KEY?.trim();
if (!apiKey || apiKey === 'paste-your-team-key-here') throw new Error('Set MICROBURBS_API_KEY in proxy/.env first.');

const api = createApiClient({ apiKey });
const statuses = new Map();
const client = { async get(path, params) {
  try {
    const result = await api.get(path, params);
    statuses.set(path, result?.data == null ? 'no data' : '200');
    return result;
  } catch (error) {
    statuses.set(path, error.status || error.cause?.code || error.name);
    throw error;
  }
} };
const server = createApp({ env, client }).listen(0, '127.0.0.1');
try {
  await once(server, 'listening');
  const query = new URLSearchParams({ address, work });
  const res = await fetch(`http://127.0.0.1:${server.address().port}/lookup?${query}`, { signal: AbortSignal.timeout(45_000) });
  const result = await res.json();
  const entries = Object.entries(result.facts).flatMap(([dimension, signals]) =>
    Object.entries(signals).map(([key, signal]) => [`${dimension}.${key}`, signal]));
  const available = entries.filter(([, signal]) => signal.available);
  if (!res.ok || result.outsideCoverage || result.matched?.confidence !== 'exact' ||
      !/^\s*(?:unit\s+)?105\s*(?:\/\s*|,\s*)8\s+sam sing street,\s+waterloo\b/i.test(result.matched.display_name) ||
      entries.length !== 18 || !available.length) {
    throw new Error(`No usable live fixture (HTTP ${res.status}; match ${result.matched?.confidence ?? 'none'}; ${available.length}/${entries.length} available).`);
  }
  await writeFile(new URL('./lookup.sample.json', import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Saved lookup.sample.json: ${result.matched.gnaf_id}; ${available.length}/${entries.length} signals available.`);
  console.log(`Unavailable: ${entries.filter(([, signal]) => !signal.available).map(([key]) => key).join(', ') || 'none'}`);
} finally {
  if (process.argv.includes('--diagnostics')) for (const [path, status] of statuses) console.log(`${path}: ${status}`);
  server.close();
}
