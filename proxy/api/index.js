// Vercel entry: the same Express app as a serverless function. Env vars come from the platform.
// Live mode when MICROBURBS_API_KEY is set (and MOCK is not "1"); otherwise the mock fixtures.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { createLiveClient } from '../src/client-live.js';
import { createMockClient } from '../src/client-mock.js';
import { refreshSuburbs } from '../src/suburbs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiKey = (process.env.MICROBURBS_API_KEY || '').trim();
const mode = process.env.MOCK === '1' || !apiKey || apiKey === 'paste-your-team-key-here' ? 'mock' : 'live';

const client =
  mode === 'live'
    ? createLiveClient({ apiKey, baseUrl: process.env.MICROBURBS_BASE_URL || 'https://api-ht.microburbs.com.au' })
    : createMockClient({ fixturesPath: path.join(here, '..', 'fixtures', 'mock.json') });

if (mode === 'live') refreshSuburbs(client).catch(() => {});

export default createApp({ client, mode });
