import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createApiClient } from './cache.js';
import { createMatcher, loadRecords } from './matcher.js';
import { findSuburb } from './src/suburbs.js';
import commute from './facts/commute.js';
import safety from './facts/safety.js';
import lifestyle from './facts/lifestyle.js';
import price from './facts/price.js';

const dimensions = { commute, safety, lifestyle, price };
const envFile = fileURLToPath(new URL('./.env', import.meta.url));
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' });
const maxInput = 240;

export function loadConfig() {
  try {
    if (typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);
    else {
      // Node 20.10 supports --env-file but has no process.loadEnvFile yet.
      const lines = readFileSync(envFile, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const item = /^\s*(?:export\s+)?(MICROBURBS_API_KEY|MICROBURBS_ADDRESSES_CSV|MICROBURBS_SOCIAL_HOUSING_CSV|PORT)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^#]*))/.exec(line);
        if (item && process.env[item[1]] === undefined) process.env[item[1]] = item[2] ?? item[3] ?? item[4].trim();
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return process.env;
}

function missingFacts(asOf) {
  return Object.fromEntries(Object.entries(dimensions).map(([key, dimension]) => [key, dimension.missing(asOf)]));
}

function blank(asOf, outsideCoverage = false, matched = null) {
  return { matched, facts: missingFacts(asOf), outsideCoverage };
}

function input(value) {
  return typeof value === 'string' && value.length <= maxInput ? value.replace(/\s+/g, ' ').trim() : '';
}

export function createApp({
  env = {},
  client = createApiClient({ apiKey: env.MICROBURBS_API_KEY?.trim() }),
  records = loadRecords(env.MICROBURBS_ADDRESSES_CSV ? resolve(dirname(envFile), env.MICROBURBS_ADDRESSES_CSV) : undefined),
  match = createMatcher({ records, geocode: (address) => client.get('/v1/geocode/address', { address }) }),
  today = () => dateFormat.format(new Date()),
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/lookup', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.get('Origin');
    if (origin && /^(?:chrome-extension:\/\/[a-p]{32}|https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)$/.test(origin)) {
      res.vary('Origin').set('Access-Control-Allow-Origin', origin);
    }
    const asOf = today();
    const address = input(req.query.address);
    const work = input(req.query.work);
    if (!address) return res.status(400).json(blank(asOf));

    try {
      const result = await match(address);
      if (result?.outsideCoverage) return res.status(403).json(blank(asOf, true));
      if (!result?.matched?.gnaf_id && !result?.buildingKey) {
        return res.json(blank(asOf, false, result?.matched ?? null));
      }
      const { matched, coordinates, coordinatesSource, buildingKey } = result;
      const suburbName = findSuburb(matched.suburb)?.apiName;
      if (!suburbName) return res.json(blank(asOf, false, matched));
      let outside = false;
      const homeGet = async (path, params) => {
        try { return await client.get(path, params); }
        catch (error) {
          if (error?.status === 403) outside = true;
          return null;
        }
      };
      const ctx = {
        matched, coordinates, coordinatesSource, buildingKey, records, work, asOf, env,
        get: (path, params) => client.get(path, params),
        property: (suffix, params) => matched.gnaf_id && (matched.confidence === 'exact' ||
          (matched.confidence === 'building' && /^(?:transport\/nearby|shapes\/|amenities\/nearby|risks\/|profile$)/.test(suffix.replace(/^\//, ''))))
          ? homeGet(`/v1/properties/${encodeURIComponent(matched.gnaf_id)}/${suffix.replace(/^\//, '')}`, params)
          : Promise.resolve(null),
        suburb: (suffix, params) => homeGet(`/v1/suburbs/${encodeURIComponent(suburbName)}/${suffix.replace(/^\//, '')}`, params),
      };
      const facts = Object.fromEntries(await Promise.all(Object.entries(dimensions).map(async ([name, dimension]) => {
        try { return [name, await dimension(ctx)]; }
        catch { return [name, dimension.missing(asOf)]; }
      })));
      return outside ? res.status(403).json(blank(asOf, true)) : res.json({ matched, facts, outsideCoverage: false });
    } catch (error) {
      const outside = error?.status === 403;
      if (error?.status === 401) {
        // A rejected key used to look exactly like "no match": say so instead.
        console.error('Microburbs rejected the API key (HTTP 401). Check MICROBURBS_API_KEY in proxy/.env, then restart.');
        return res.status(502).json({ ...blank(asOf), error: { code: 'upstream_auth',
          message: 'Microburbs rejected the proxy API key (HTTP 401). Put the team key in proxy/.env and restart the proxy.' } });
      }
      return res.status(outside ? 403 : 200).json(blank(asOf, outside));
    }
  });
  return app;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const env = loadConfig();
  const port = Number(env.PORT) || 3000;
  const app = createApp({ env });
  app.listen(port, '127.0.0.1', (error) => {
    if (error) {
      console.error(`Proxy could not listen on port ${port} (${error.code || 'listen error'}).`);
      process.exitCode = 1;
    } else {
      console.log(`Fit proxy listening at http://localhost:${port}`);
      // One cheap call so a wrong key shows up at startup, not as empty lookups. The key is never logged.
      createApiClient({ apiKey: env.MICROBURBS_API_KEY?.trim() }).get('/v1/me')
        .then(() => console.log('Microburbs API key accepted.'))
        .catch((e) => console.error(`Microburbs API key check failed (HTTP ${e?.status ?? 'network'}): ${e?.status === 401 ? 'key rejected, fix MICROBURBS_API_KEY in proxy/.env' : 'see above'}.`));
    }
  });
}
