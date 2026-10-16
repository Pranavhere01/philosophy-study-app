# A Little Clearer — study companion (web)

A calm, offline, single-page study web app for the **IGNOU MAPY + UGC NET Philosophy** first pass
(16 October → 19 November 2026). It is a conventional static site: four files, no build step, no
server, no network requests, no account. Progress is saved to the browser's local storage and can
be moved between devices with **Export JSON / Import**.

## Files

| File | Role |
|---|---|
| `index.html` | Page shell and semantic structure |
| `styles.css` | Design system (light + dark, mobile-first) |
| `app.js` | All behaviour: views, state, import/export |
| `data.js` | The curriculum (courses, units, days, NET packets, reading map) |

`data.js` is **generated** — do not edit it by hand. Rebuild it from the canonical data with:

```bash
python3 .build/gen_web_data.py
```

## Run it locally

Open `index.html` directly (double-click), or serve the folder:

```bash
cd web && python3 -m http.server 8000
# → http://localhost:8000
```

All asset references are relative, so it works from a subfolder or a subpath — exactly what
GitHub Pages project sites need.

## Deploy to GitHub Pages

The app is self-contained and needs only static hosting.

### Option A — deploy this folder from a dedicated repository

1. Copy the four files (`index.html`, `styles.css`, `app.js`, `data.js`) plus `.nojekyll` into a
   repository (a dedicated site repo is recommended so the private study workspace is never
   published whole).
2. On GitHub: **Settings → Pages → Build and deployment → Source = Deploy from a branch**,
   select `main` and the `/ (root)` folder.
3. Open `https://<you>.github.io/<repo>/`.

### Option B — deploy from the `web/` folder of this workspace

1. Commit the `web/` folder.
2. On GitHub: **Settings → Pages → Source = GitHub Actions** or **Deploy from a branch →
   `/web`** (when deploying from a branch you can point the folder at `web`).
3. Open `https://<you>.github.io/<workspace-repo>/`.

Either way the site is served under a subpath, and every link/asset is relative, so it loads
without a `<base>` tag or absolute URLs.

## What it is — and is not

- **It is** a portable first-pass checklist and reading room: 14 courses, 241 IGNOU units,
  62 NET packets, 35 days, and the full reading/lecture map with exact locators.
- **It saves** ticks, notes, practice scores and chanting rounds to this browser only.
- **It does not** sync across devices by itself — export/import JSON to move progress.
- **It does not** contain personal progress, enrolment details, tokens or copyrighted PDFs; it
  ships with empty progress and links out to the source material at its original institutions.

## Privacy

Nothing is uploaded. Your ticks and notes live in your browser. Exporting a JSON backup is your
choice; treat that file as private.
