/**
 * Local dev launcher (Windows-friendly).
 *
 * Starts `vercel dev` on a local port so the app serves from a single
 * origin. The port is left to Vercel (3000, 3001, …) so conflicts don't
 * break the flow; the Ready! URL Vercel prints tells you where to open
 * the app.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const child = spawn('npx vercel dev --local --non-interactive', {
    cwd: root,
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