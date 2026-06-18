# Speaker Bench

A lightweight static web app for speaker checks and quick calibration:

- White noise and pink noise
- Sine tone and sine sweep modes
- Left, right, both, and alternating channel routing
- Output level control with live left/right meters
- Optional microphone input meter for relative room checks
- Channel pings and a polarity pulse utility

## Run Locally

Use any static file server from this folder:

```sh
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Deploy To GitHub Pages

This repo includes a GitHub Actions workflow that publishes the static files from the repository root to GitHub Pages.

1. Push this folder to a GitHub repository.
2. In the repository settings, set Pages source to **GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` will deploy on pushes to `main`.

The app has no build step and no runtime dependencies.
