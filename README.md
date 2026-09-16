# Radio Safar V3.3

**Every mood has a journey.**

Radio Safar is a nostalgic highway radio experience — a cinematic, full-screen Indian radio that streams mood-based YouTube playlists through a premium glass player. Built for night drives, deep focus, and chill moments.

![Favicon](https://img.shields.io/badge/Radio-Safar-ffaa1d)

## Features

- **Cinematic layered background** — night-highway photography with warm bokeh, Indian truck-art texture, film grain, and a slow GPU-cheap drift. No video files, no toggles.
- **रेडियो सफर branding** — dominant Devanagari title with a Hindi tagline, responsive on desktop and mobile.
- **18 curated playlists** — Radha Krishna, 90s, Hindi, Bhakti, Punjabi, Bhojpuri, Tamil, Telugu, Kannada, and more. The app always starts on the **1st playlist** (राधा कृष्ण भजन).
- **Full HTML5 player UI** — play/pause, next/previous, shuffle, seekbar, spinning CD, stereo VU meters, bus horn, minimizable console, and live clock.
- **Optional full playlist pagination** — when a YouTube Data API v3 key is configured, playlists larger than 200 videos load completely (the IFrame player API itself caps at ~200).
- **Profile/info card** — premium glass "i" card with creator details, features, song requests, and disclaimer.
- **Live listener presence** — a Supabase-powered counter of travellers currently on the road.

## Tech Stack

- Vanilla JavaScript (ES modules) — no framework, no runtime dependencies
- [Vite 5](https://vitejs.dev) — build tool and dev server
- YouTube IFrame Player API (audio playback, `youtube-nocookie.com`)
- Supabase Realtime (optional presence counter)
- Google Fonts: Rozha One, Orbitron, Plus Jakarta Sans, Tiro Devanagari Hindi, JetBrains Mono

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server (usually http://localhost:5173)
npm run dev

# 3. Production build (outputs to dist/)
npm run build

# 4. Preview the production build locally
npm run preview
```

Node.js `>= 18.0.0` is required (Vite 5).

## Environment Variables

All keys are **optional** — the app runs without any configuration.

| Variable | Required | Purpose | Scope |
| --- | --- | --- | --- |
| `VITE_YOUTUBE_API_KEY` | No | YouTube Data API v3 key. Enables full pagination so playlists over 200 videos load completely. When omitted, playlists load through the player's built-in path (existing behavior, ~200-video cap). | **Public / client-side** (baked into the bundle) |

> For `VITE_YOUTUBE_API_KEY`: create a key at [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials), enable the **YouTube Data API v3**, and add the key to your Vercel environment.

Copy `.env.example` to `.env.local` locally if you want to test with keys:

```bash
copy .env.example .env.local
```

The Supabase URL and publishable key used for the live listener counter are intentionally public (browser-facing) and ship inside the bundle. They contain no secrets.

## Vercel Deployment

The project deploys to [https://radiosafar.vercel.app](https://radiosafar.vercel.app) with no extra configuration:

- **Framework preset:** Vite (auto-detected)
- **Build command:** `npm run build`
- **Output directory:** `dist` (relative to the project root)
- **Node version:** ≥ 18 (Vercel's default runtime qualifies)

There is no `vercel.json` and no server-side routing, so nothing else is needed. Connect the GitHub repository in the Vercel dashboard (Import Project / Git integration) — fresh pushes trigger automatic deployments.

**Required env setup in the Vercel project dashboard** (optional, but needed for full functionality):

| Variable | Set as | Applied to |
| --- | --- | --- |
| `VITE_YOUTUBE_API_KEY` | Plain (public) | Production, Preview, Development |

`VITE_YOUTUBE_API_KEY` must **not** be encrypted — Vite expects it at build time to inline it into the client bundle.

## Project Structure

```
radio-safar/
├── public/                    # Static assets copied verbatim to dist/
│   ├── radio-safar-highway-desktop.jpg
│   ├── radio-safar-highway-mobile.jpg
│   ├── truck-1.mp3
│   └── truck-2.mp3
├── src/
│   ├── index.html             # Single page: layered background + player + modals + favicon
│   ├── main.js                # App entry: wires player, modals, clock, presence
│   ├── components/
│   │   ├── clock.js
│   │   └── modals.js
│   ├── config/
│   │   ├── bumpers.js         # Rotating Hindi bumper messages
│   │   └── playlists.js       # All 18 mood playlists (1st entry = default)
│   ├── services/
│   │   ├── horn.js            # Bus horn sound effects
│   │   ├── playlist-api.js    # YouTube Data API v3 pagination
│   │   ├── presence.js        # Supabase live-listener counter
│   │   └── youtube.js         # IFrame player bootstrap + playlist logic
│   └── styles/
│       └── style.css
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
└── vite.config.js
```

## Important Configuration Notes

- `vite.config.js` uses `root: 'src'`, `publicDir: '../public'`, and `outDir: '../dist'`. Vercel therefore reads build output from the project-root `dist/` directory.
- The **default playlist is the first entry in `MOOD_PLAYLISTS`** (राधा कृष्ण भजन). This is computed with `Object.keys(MOOD_PLAYLISTS)[0]` — never hard-coded to any specific mood.
- The favicon is an inline SVG data URI in `src/index.html` — it ships with the HTML and needs no separate file.
- No MP4 background video, no video/photo toggle — the visible background is the layered photo composition only.

## License

This project is created for non-commercial enjoyment and music lovers. All songs are streamed via YouTube playlists; all rights remain with the original artists, composers, record labels, and copyright owners.
