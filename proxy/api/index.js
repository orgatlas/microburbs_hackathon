// Vercel entry: the same live-only Express app as proxy/server.js, run as a serverless function.
// MICROBURBS_API_KEY comes from the platform's environment variables. Every fact is fetched live from Microburbs.
import { createApp } from '../server.js';

export default createApp({ env: process.env });
