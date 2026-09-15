/**
 * Local dev launcher (Windows-friendly).
 *
 * Starts `vercel dev` with the GEMINI_API_KEY value taken from .env.local —
 * the single source of truth for local secrets. The key is passed to the
 * Vercel local function runtime via the child environment, never printed,
 * never written on a command line, and never sent to the Vercel cloud.
 *
 * The port is left to Vercel (3000, 3001, …) so conflicts don't break the
 * flow; the Ready! URL Vercel prints tells you where to open the app.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env.local');

function loadEnvVars(file) {
    const out = {};
    if (!existsSync(file)) return out;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq === -1) continue;
        let value = t.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (value) out[t.slice(0, eq).trim()] = value;
    }
    return out;
}

const local = loadEnvVars(envFile);
const env = { ...process.env, ...local };

if (local.GEMINI_API_KEY) {
    console.log(`[local-dev] GEMINI_API_KEY loaded from .env.local (${String(local.GEMINI_API_KEY).length} chars; value hidden).`);
} else {
    console.warn('[local-dev] WARNING: GEMINI_API_KEY is missing in .env.local — the Safar Saathi API will return 503.');
}

const child = spawn('npx vercel dev --local --non-interactive', {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: true
});

child.on('error', err => {
    console.error('[local-dev] Could not start vercel dev:', err.message);
    process.exit(1);
});
child.on('exit', code => process.exit(code ?? 0));

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
}