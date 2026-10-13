# Min-Max Tracker
Static SPA (no backend). Serve: `python3 -m http.server 8765` in this folder, open http://127.0.0.1:8765/.
Data: localStorage key `minmax-tracker-v1`; Settings → Export/Import JSON for backup.
Files: index.html, styles.css, app.js, sw.js, manifest.webmanifest, icons/, data/spec.js (spec JSON embedded), vendor/chart.umd.min.js (Chart.js 4.4.4), vendor/supabase.js.
Home screen shows the next workout in the split. Start records that session's start time, then the gym logger (steppers, one-tap sets, rest timer) takes over. Add to the home screen for a full-screen logger; the shell caches for poor signal and training data stays in localStorage until sync.
