# CS 1.6 / WebXash — no server needed, CS-only start screen

Just double-click **index.html** and it opens straight in your browser. No `python -m http.server`,
no dev server, no dependency on x8bitrain.github.io at any point — everything the engine needs
is embedded directly in `bundle.js`.

This build always launches Counter-Strike 1.6 — the Half-Life/game-selector screen, built-in
demo downloads, and folder-picker have been removed. You just get one screen: pick your zip.

## Fixed: blank screen on open

The version I sent you right before this one had a layout bug: the wrapper div around the new
start screen used to get its height from the old game-picker menu, which I removed. With
nothing left inside it, that wrapper collapsed to zero height and (combined with `overflow:
hidden` on it) clipped the whole start screen out of view — so the page loaded fine but showed
nothing. Fixed by making the start screen `position: fixed` so it fills the viewport directly
instead of depending on that wrapper's size.

## What's in here

- `index.html` — the page
- `bundle.js` (~13MB) — the entire app: a small custom Vue start screen + the Xash3D engine,
  CS menu/client/server DLLs, and `extras.pk3`, all compiled to WebAssembly and embedded as
  base64 data directly in this one script. Nothing is fetched over the network — verified zero
  `fetch()` calls at runtime.
- `assets/style-*.css`, `assets/hl-bright-*.svg` — stylesheet + favicon (loaded as plain local
  files, not modules, so `file://` has no problem with them either)

## How to use it

1. Double-click `index.html` (or drag it into a browser window).
2. You'll see one screen: **Open ZIP**. Click it.
3. Pick a zip whose root contains a `valve/` folder (base Half-Life assets) and a `cstrike/`
   folder (your Counter-Strike 1.6 assets):

```
yourzip.zip
├── valve/
└── cstrike/
```

4. It loads straight into the canvas.

## Why this works without a server

Browsers normally block two things under `file://`:
- ES module scripts (`<script type="module">`) and `import()` — fixed by rebuilding the whole
  app as a single classic script (no `type="module"`, no code-splitting, no dynamic imports).
- `fetch()` of local `.wasm`/`.pk3` files — fixed by inlining every one of those assets as a
  `data:` URI directly inside `bundle.js` at build time, instead of loading them as separate
  files.

## Trade-offs

- **Bigger single file** (~13MB `bundle.js`) — base64 encoding inflates the binary assets by
  ~33%, and disabling code-splitting means nothing loads lazily.
- **Save games** use IndexedDB, which real browsers do support under `file://`, but some
  browsers apply extra restrictions there. If save/load misbehaves, hosting on any static file
  server avoids that entirely while still needing no external GitHub dependency.
- No game-mode switch, folder-picker, launch-options box, or multiplayer/save UI — just the zip
  picker, per your request. Say the word if you want any of those back.

## License note

xash3d-fwgs, hlsdk-portable, and cs16-client are open-source (GPL-family) projects; this build
just packages their published npm binaries. You still need to legally own Counter-Strike 1.6 /
Half-Life to supply the actual `cstrike`/`valve` game data — none of that content is included.
