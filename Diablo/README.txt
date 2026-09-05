DiabloWeb - offline / file:// build
===================================

This is a hand-adapted version of the DiabloWeb project
(https://github.com/d07RiV/diabloweb) that runs by simply double-clicking
index.html - no build step, no local server, no internet connection needed.

HOW TO USE
----------
1. Unzip this folder somewhere on your computer (keep all the files
   together - index.html, app.js, style.css, Diablo.jscc.js,
   DiabloSpawn.jscc.js, wasm-data.js).
2. Double-click index.html (or open it via File > Open in your browser).
3. Drag your own DIABDAT.MPQ (from your legally-owned copy of Diablo,
   e.g. from GoG) onto the page, or click "Select MPQ File". A
   shareware "spawn.mpq" file works the same way.

WHY THIS NEEDED CHANGES FROM THE ORIGINAL PROJECT
--------------------------------------------------
The original project is a React app built with webpack; the normal build
output still expects to be served over http(s):// - browsers block a few
things a page needs when it's opened as a plain file:// document:
  - fetch()/XMLHttpRequest to other local files (used to download the
    ~1.5MB .wasm engine) is blocked for file:// pages in most browsers.
  - Web Workers (used to run the game off the main thread) generally
    cannot be created from a file:// page at all.

To work around this, in this build:
  - The compiled game engine (Diablo.wasm / DiabloSpawn.wasm) is embedded
    as base64 text inside wasm-data.js and decoded in memory, instead of
    being fetched.
  - The game logic that used to run in a Web Worker now runs directly on
    the main thread (app.js is a hand-written, un-bundled port of the
    project's src/App.js, src/fs.js and src/api/*.js).

WHAT'S DIFFERENT FROM THE HOSTED VERSION
-----------------------------------------
To keep this manageable as a hand port (rather than a real webpack build),
a few secondary features from the original site were left out:
  - Online multiplayer (WebRTC / websocket relay) is disabled.
  - The in-browser "compress my MPQ" tool is not included.
  - Touch controls for mobile are not included (keyboard + mouse only).
  - Google Analytics is not included.

Core single-player gameplay, saving/loading, and sound all work the same
way as the original.

TROUBLESHOOTING
----------------
- "IndexedDB is not supported" / saves don't persist: some browsers
  restrict storage for file:// pages, particularly in private/incognito
  mode. Try a normal browser window.
- If your browser refuses to run this at all, you can also just run any
  local static file server from this folder (e.g. `npx serve .` or
  `python3 -m http.server`) and open http://localhost:<port>/ instead -
  that avoids file:// restrictions entirely.

Original project & credits: https://github.com/d07RiV/diabloweb
(based on https://github.com/diasurgical/devilution)


Automatic MPQ loading:
The launcher downloads and reassembles 11 split parts from the configured GitHub raw path before starting Diablo. The split format uses 45 MiB parts, matching split.py.
