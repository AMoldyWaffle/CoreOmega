/* DiabloWeb - standalone file:// build
 * Hand-ported from https://github.com/diasurgical/devilution / d07RiV/diabloweb
 * to run as plain scripts (no bundler, no Web Worker, no network fetch) so it
 * can be opened directly from disk (file:///.../index.html).
 *
 * Original project: MIT-style hobby project by d07RiV. This file re-implements
 * src/fs.js, src/api/sound.js, src/api/loader.js, src/api/game.worker.js and
 * src/App.js from that project as plain, un-bundled JavaScript.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; ++i) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // ---------------------------------------------------------------------
  // Persistent storage (IndexedDB), replaces src/fs.js (idb-kv-store)
  // ---------------------------------------------------------------------
  const DB_NAME = "diablo_fs";
  const STORE = "files";

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbGetAll(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const out = new Map();
      const req = store.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) {
          out.set(cur.key, cur.value);
          cur.continue();
        } else {
          resolve(out);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  function idbSet(db, key, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function idbDelete(db, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function idbClear(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function downloadBytes(name, data) {
    const blob = new Blob([data], { type: "binary/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const readFileAsArrayBuffer = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.onabort = () => reject(new Error("aborted"));
      reader.readAsArrayBuffer(file);
    });

  async function create_fs() {
    try {
      const db = await idbOpen();
      const files = await idbGetAll(db);
      window.DownloadFile = (name) => {
        const f = files.get(name.toLowerCase());
        if (f) downloadBytes(name, f);
      };
      window.DownloadSaves = () => {
        for (const name of files.keys()) {
          if (/\.sv$/i.test(name)) window.DownloadFile(name);
        }
      };
      return {
        files,
        update: (name, data) => idbSet(db, name, data),
        delete: (name) => idbDelete(db, name),
        clear: () => idbClear(db),
        download: (name) => {
          const f = files.get(name.toLowerCase());
          if (f) downloadBytes(name, f);
        },
        upload: async (file) => {
          const data = new Uint8Array(await readFileAsArrayBuffer(file));
          files.set(file.name.toLowerCase(), data);
          return idbSet(db, file.name.toLowerCase(), data);
        },
        fileUrl: async (name) => {
          const f = files.get(name.toLowerCase());
          if (f) {
            const blob = new Blob([f], { type: "binary/octet-stream" });
            return URL.createObjectURL(blob);
          }
        },
      };
    } catch (e) {
      console.warn("IndexedDB unavailable, saves will not persist:", e);
      window.DownloadFile = () => console.error("IndexedDB is not supported");
      window.DownloadSaves = () => console.error("IndexedDB is not supported");
      return {
        files: new Map(),
        update: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        clear: () => Promise.resolve(),
        download: () => Promise.resolve(),
        upload: () => Promise.resolve(),
        fileUrl: () => Promise.resolve(undefined),
      };
    }
  }

  // ---------------------------------------------------------------------
  // Audio, replaces src/api/sound.js
  // ---------------------------------------------------------------------
  function init_sound() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const StereoPannerNode = window.StereoPannerNode;
    if (!AudioContext) {
      return {
        create_sound: () => 0,
        create_sound_raw: () => 0,
        duplicate_sound: () => 0,
        play_sound: () => undefined,
        set_volume: () => undefined,
        stop_sound: () => undefined,
        delete_sound: () => undefined,
        stop_all: () => undefined,
      };
    }
    let context = null;
    try {
      context = new AudioContext();
      context.resume();
    } catch (e) {}
    const sounds = new Map();
    function decodeAudioData(buffer) {
      return new Promise((resolve, reject) => {
        context.decodeAudioData(buffer, resolve, reject);
      });
    }
    return {
      create_sound_raw(id, data, length, channels, rate) {
        if (!context) return;
        const buffer = context.createBuffer(channels, length, rate);
        for (let i = 0; i < channels; ++i) {
          buffer.getChannelData(i).set(data.subarray(i * length, i * length + length));
        }
        sounds.set(id, {
          buffer: Promise.resolve(buffer),
          gain: context.createGain(),
          panner: StereoPannerNode && new StereoPannerNode(context, { pan: 0 }),
        });
      },
      create_sound(id, data) {
        if (!context) return;
        const buffer = decodeAudioData(data.buffer);
        sounds.set(id, {
          buffer,
          gain: context.createGain(),
          panner: StereoPannerNode && new StereoPannerNode(context, { pan: 0 }),
        });
      },
      duplicate_sound(id, srcId) {
        if (!context) return;
        const src = sounds.get(srcId);
        if (!src) return;
        sounds.set(id, {
          buffer: src.buffer,
          gain: context.createGain(),
          panner: StereoPannerNode && new StereoPannerNode(context, { pan: 0 }),
        });
      },
      play_sound(id, volume, pan, loop) {
        const src = sounds.get(id);
        if (src) {
          if (src.source) src.source.then((s) => s.stop());
          src.gain.gain.value = Math.pow(2.0, volume / 1000.0);
          const relVolume = Math.pow(2.0, pan / 1000.0);
          if (src.panner) src.panner.pan.value = 1.0 - 2.0 / (1.0 + relVolume);
          src.source = src.buffer.then((buffer) => {
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.loop = !!loop;
            let node = source.connect(src.gain);
            if (src.panner) node = node.connect(src.panner);
            node.connect(context.destination);
            source.start();
            return source;
          });
        }
      },
      set_volume(id, volume) {
        const src = sounds.get(id);
        if (src) src.gain.gain.value = Math.pow(2.0, volume / 1000.0);
      },
      stop_sound(id) {
        const src = sounds.get(id);
        if (src && src.source) {
          src.source.then((s) => s.stop());
          delete src.source;
        }
      },
      delete_sound(id) {
        const src = sounds.get(id);
        if (src && src.source) src.source.then((s) => s.stop());
        sounds.delete(id);
      },
      stop_all() {
        for (const [, sound] of sounds) {
          if (sound.source) sound.source.then((s) => s.stop());
        }
        sounds.clear();
        context = null;
      },
    };
  }

  // ---------------------------------------------------------------------
  // Game engine bridge, replaces src/api/game.worker.js (runs on main
  // thread instead of a Worker - Worker() cannot be created from a
  // file:// page in most browsers, but everything here was already just
  // plain message-passing, so we call straight through instead).
  // ---------------------------------------------------------------------
  const DiabloSize = 1466809;
  const SpawnSize = 1337416;

  function createEngine(ui) {
    const audio = init_sound();
    let wasm = null;
    let is_spawn = false;
    let renderBatch = null;
    let drawBelt = null;
    let files = null;

    function onError(err, action) {
      action = action || "error";
      if (action === "error") {
        audio.stop_all();
        ui.onError(err instanceof Error ? err.toString() : String(err), err && err.stack);
      } else {
        ui.onLoadFailed({ message: err instanceof Error ? err.toString() : String(err), stack: err && err.stack });
      }
    }

    function try_api(func) {
      try {
        func();
      } catch (e) {
        onError(e);
      }
    }

    const DApi = {
      exit_error(error) {
        throw new Error(error);
      },
      exit_game() {
        ui.onExit();
      },
      current_save_id(id) {
        ui.setCurrentSave(id >= 0 ? (is_spawn ? `spawn${id}.sv` : `single_${id}.sv`) : null);
      },
      get_file_size(path) {
        const data = files.get(path.toLowerCase());
        return data ? data.byteLength : 0;
      },
      get_file_contents(path, array, offset) {
        const data = files.get(path.toLowerCase());
        if (data) array.set(data.subarray(offset, offset + array.byteLength));
      },
      put_file_contents(path, array) {
        path = path.toLowerCase();
        files.set(path, array);
        ui.fs.update(path, array);
      },
      remove_file(path) {
        path = path.toLowerCase();
        files.delete(path);
        ui.fs.delete(path);
      },
      set_cursor(x, y) {
        ui.setCursorPos(x, y);
      },
      open_keyboard(...args) {
        ui.openKeyboard(args);
      },
      close_keyboard() {
        ui.openKeyboard(null);
      },
      // Multiplayer (websocket relay) is not supported in this offline build.
      use_websocket() {},
      websocket_closed() {
        return true;
      },
      websocket_send() {},

      draw_begin() {
        renderBatch = { images: [], text: [], clip: null, belt: drawBelt };
        drawBelt = null;
      },
      draw_blit(x, y, w, h, data) {
        renderBatch.images.push({ x, y, w, h, data: data.slice() });
      },
      draw_clip_text(x0, y0, x1, y1) {
        renderBatch.clip = { x0, y0, x1, y1 };
      },
      draw_text(x, y, text, color) {
        renderBatch.text.push({ x, y, text, color });
      },
      draw_end() {
        ui.onRender(renderBatch);
        renderBatch = null;
      },
      draw_belt(items) {
        drawBelt = items.slice();
      },
    };

    ["create_sound_raw", "create_sound", "duplicate_sound", "play_sound", "set_volume", "stop_sound", "delete_sound"].forEach((func) => {
      DApi[func] = function (...params) {
        audio[func](...params);
      };
    });

    window.DApi = DApi;

    function call_api(func, ...params) {
      try_api(() => {
        if (func !== "text") {
          wasm["_" + func](...params);
        } else {
          const ptr = wasm._DApi_SyncTextPtr();
          const text = params[0];
          const length = Math.min(text.length, 255);
          const heap = wasm.HEAPU8;
          for (let i = 0; i < length; ++i) heap[ptr + i] = text.charCodeAt(i);
          heap[ptr + length] = 0;
          wasm._DApi_SyncText(params[1]);
        }
      });
    }

    async function initWasm(spawn, onProgress) {
      const bytes = spawn ? b64ToBytes(window.DIABLOSPAWN_WASM_B64) : b64ToBytes(window.DIABLO_WASM_B64);
      if (onProgress) onProgress({ loaded: bytes.byteLength });
      const factory = spawn ? window.DiabloSpawn : window.Diablo;
      const result = await factory({ wasmBinary: bytes.buffer }).ready;
      if (onProgress) onProgress({ loaded: 2000000 });
      return result;
    }

    async function init_game(mpqFile, spawn, fsFiles) {
      is_spawn = spawn;
      files = fsFiles;

      ui.onProgress({ text: "Loading..." });
      let mpqLoaded = 0,
        mpqTotal = mpqFile ? mpqFile.size : 0,
        wasmLoaded = 0,
        wasmTotal = spawn ? SpawnSize : DiabloSize;
      const wasmWeight = 5;
      function updateProgress() {
        ui.onProgress({ text: "Loading...", loaded: mpqLoaded + wasmLoaded * wasmWeight, total: mpqTotal + wasmTotal * wasmWeight });
      }
      const loadWasm = initWasm(spawn, (e) => {
        wasmLoaded = Math.min(e.loaded, wasmTotal);
        updateProgress();
      });
      const loadMpq = mpqFile
        ? readFileAsArrayBuffer(mpqFile).then((buf) => {
            mpqLoaded = mpqFile.size;
            updateProgress();
            return buf;
          })
        : Promise.resolve(null);
      const results = await Promise.all([loadWasm, loadMpq]);
      wasm = results[0];
      const mpqBuf = results[1];

      if (mpqBuf) {
        files.set(spawn ? "spawn.mpq" : "diabdat.mpq", new Uint8Array(mpqBuf));
      }

      ui.onProgress({ text: "Initializing..." });

      wasm._DApi_Init(Math.floor(performance.now()), 0, 1, 0, 39);

      setInterval(() => {
        call_api("DApi_Render", Math.floor(performance.now()));
      }, 50);
    }

    return {
      init(mpqFile, spawn, fsFiles) {
        return init_game(mpqFile, spawn, fsFiles);
      },
      event(func, ...params) {
        call_api(func, ...params);
      },
    };
  }

  // ---------------------------------------------------------------------
  // UI controller, replaces src/App.js (minus touch controls, multiplayer,
  // MPQ compression, and analytics, which are not needed for an offline
  // single-file/single-folder build).
  // ---------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);

  function App() {
    this.fsPromise = create_fs();
    this.fs = null;
    this.saveName = null;
    this.started = false;
    this.cursorPos = { x: 0, y: 0 };
    this.showKeyboard = false;
    this.maxKeyboard = 0;
    this.keyboardNum = 0;

    this.root = $("app");
    this.canvas = $("canvas");
    this.keyboardInput = $("keyboardInput");
    this.startScreen = $("startScreen");
    this.loadingScreen = $("loadingScreen");
    this.errorScreen = $("errorScreen");
    this.savesScreen = $("savesScreen");
    this.progressText = $("progressText");
    this.progressBar = $("progressBarInner");
    this.errorBody = $("errorBody");
    this.errorLink = $("errorLink");
    this.saveDownload = $("saveDownload");

    this.engine = createEngine(this);

    this.bindUi();
  }

  // Automatically download and reconstruct DIABDAT.MPQ from split GitHub parts.
  // The parts were created by split.py using 45 MiB chunks.
  const REMOTE_MPQ_BASE =
    "https://raw.githubusercontent.com/AMoldyWaffle/PS2-HTML-ORYX/main/Diablo1/diabdat.mpq.part";
  const REMOTE_MPQ_PARTS = 11;
  const REMOTE_MPQ_PART_SIZE = 45 * 1024 * 1024;

  async function loadRemoteMpq(onProgress) {
    // Fetch each part sequentially to avoid opening 11 large downloads at once.
    const parts = [];
    let total = 0;

    for (let i = 1; i <= REMOTE_MPQ_PARTS; i++) {
      const partName = String(i).padStart(2, "0");
      const url = REMOTE_MPQ_BASE + partName;

      onProgress({
        text: `Downloading DIABDAT.MPQ part ${i}/${REMOTE_MPQ_PARTS}...`,
        loaded: total,
        total: REMOTE_MPQ_PARTS * REMOTE_MPQ_PART_SIZE,
      });

      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Failed to download ${url} (HTTP ${response.status})`);
      }

      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      parts.push(bytes);
      total += bytes.byteLength;

      onProgress({
        text: `Downloaded DIABDAT.MPQ part ${i}/${REMOTE_MPQ_PARTS}`,
        loaded: total,
        total: REMOTE_MPQ_PARTS * REMOTE_MPQ_PART_SIZE,
      });
    }

    // Reassemble the exact original DIABDAT.MPQ.
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      combined.set(part, offset);
      offset += part.byteLength;
    }

    return new File([combined], "DIABDAT.MPQ", {
      type: "application/octet-stream",
      lastModified: Date.now(),
    });
  }

  App.prototype.bindUi = function () {
    const self = this;

    $("fileInput").addEventListener("change", (e) => {
      if (e.target.files.length) self.start(e.target.files[0]);
    });
    $("manageSaves").addEventListener("click", () => self.showSaves());
    $("savesBack").addEventListener("click", () => self.hideSaves());
    $("saveFileInput").addEventListener("change", (e) => {
      if (e.target.files.length) self.uploadSave(e.target.files[0]);
    });

    ["dragenter", "dragover"].forEach((ev) =>
      document.addEventListener(
        ev,
        (e) => {
          if (self.started) return;
          e.preventDefault();
          self.root.classList.add("dropping");
        },
        true
      )
    );
    ["dragleave", "drop"].forEach((ev) =>
      document.addEventListener(
        ev,
        (e) => {
          if (self.started) return;
          e.preventDefault();
          self.root.classList.remove("dropping");
        },
        true
      )
    );
    document.addEventListener(
      "drop",
      (e) => {
        if (self.started) return;
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) self.start(file);
      },
      true
    );

    this.fsPromise.then(async (fs) => {
      this.fs = fs;
      const saveCount = [...fs.files.keys()].filter((n) => /\.sv$/i.test(n)).length;
      if (saveCount) $("manageSaves").style.display = "";

      // No file picker is required: automatically reconstruct and start the game.
      try {
        this.setScreen("loadingScreen");
        this.progressText.textContent = "Downloading DIABDAT.MPQ...";
        this.progressBar.style.width = "0%";

        const mpqFile = await loadRemoteMpq((p) => {
          this.progressText.textContent = p.text;
          if (p.total) {
            this.progressBar.style.width =
              Math.min(100, Math.round((100 * p.loaded) / p.total)) + "%";
          }
        });

        await this.start(mpqFile);
      } catch (e) {
        this.onLoadFailed({
          message: `Could not automatically load DIABDAT.MPQ: ${e.message}`,
          stack: e && e.stack,
        });
      }
    });
  };

  App.prototype.setScreen = function (name) {
    [this.startScreen, this.loadingScreen, this.errorScreen, this.savesScreen].forEach((el) => (el.style.display = "none"));
    if (name) $(name).style.display = "";
  };

  App.prototype.showSaves = function () {
    this.refreshSaveList();
    this.setScreen("savesScreen");
  };
  App.prototype.hideSaves = function () {
    this.setScreen("startScreen");
  };
  App.prototype.refreshSaveList = function () {
    const list = $("saveList");
    list.innerHTML = "";
    const names = [...this.fs.files.keys()].filter((n) => /\.sv$/i.test(n));
    for (const name of names) {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = name;
      li.appendChild(label);
      const dl = document.createElement("button");
      dl.textContent = "Download";
      dl.onclick = () => this.fs.download(name);
      li.appendChild(dl);
      const rm = document.createElement("button");
      rm.textContent = "Delete";
      rm.onclick = () => {
        if (window.confirm(`Delete ${name}?`)) {
          this.fs.delete(name).then(() => {
            this.fs.files.delete(name);
            this.refreshSaveList();
          });
        }
      };
      li.appendChild(rm);
      list.appendChild(li);
    }
  };
  App.prototype.uploadSave = function (file) {
    this.fs.upload(file).then(() => this.refreshSaveList());
  };

  App.prototype.start = function (file) {
    if (file && /\.sv$/i.test(file.name)) {
      this.fs.upload(file).then(() => this.refreshSaveList());
      return;
    }
    if (file && !/\.mpq$/i.test(file.name)) {
      window.alert(
        "Please select an MPQ file. If you downloaded the installer from GoG, you will need to install it on PC and use the MPQ file from the installation folder."
      );
      return;
    }
    if (!file) {
      return;
    }
    const spawn = /^spawn\.mpq$/i.test(file.name);

    this.setScreen("loadingScreen");
    this.progressText.textContent = "Loading...";
    this.progressBar.style.width = "0%";

    return this.engine
      .init(file, spawn, this.fs.files)
      .then(() => {
        this.started = true;
        this.root.classList.add("started");
        this.setScreen(null);
        this.attachGameEvents();
      })
      .catch((e) => {
        this.onLoadFailed({ message: e.message, stack: e.stack });
        throw e;
      });
  };

  App.prototype.onLoadFailed = function (err) {
    this.showError(err);
  };

  App.prototype.showError = function (errorObject) {
    this.setScreen("errorScreen");
    this.errorBody.textContent = errorObject.message || "Unknown error";
    const message = (errorObject.message || "Unknown error") + (errorObject.stack ? "\n" + errorObject.stack : "");
    const url = new URL("https://github.com/d07RiV/diabloweb/issues/new");
    url.searchParams.set(
      "body",
      `**Description:**\n[Please describe what you were doing before the error occurred]\n\n**Error message:**\n\n${message
        .split("\n")
        .map((l) => "    " + l)
        .join("\n")}\n\n**User agent:**\n\n    ${navigator.userAgent}\n`
    );
    this.errorLink.href = url.toString();
    if (this.saveName) {
      this.fs.fileUrl(this.saveName).then((u) => {
        if (u) {
          this.saveDownload.href = u;
          this.saveDownload.download = this.saveName;
          this.saveDownload.style.display = "";
        }
      });
    } else {
      this.saveDownload.style.display = "none";
    }
  };

  App.prototype.onError = function (message, stack) {
    this.showError({ message, stack });
  };

  App.prototype.onProgress = function (progress) {
    this.progressText.textContent = (progress && progress.text) || "Loading...";
    if (progress && progress.total) {
      this.progressBar.style.width = Math.round((100 * progress.loaded) / progress.total) + "%";
    }
  };

  App.prototype.onExit = function () {
    window.location.reload();
  };

  App.prototype.setCurrentSave = function (name) {
    this.saveName = name;
  };

  App.prototype.setCursorPos = function (x, y) {
    const rect = this.canvas.getBoundingClientRect();
    this.cursorPos = {
      x: rect.left + ((rect.right - rect.left) * x) / 640,
      y: rect.top + ((rect.bottom - rect.top) * y) / 480,
    };
    setTimeout(() => this.engine.event("DApi_Mouse", 0, 0, 0, x, y));
  };

  App.prototype.openKeyboard = function (rect) {
    if (rect) {
      this.showKeyboard = true;
      this.maxKeyboard = rect[4];
      this.root.classList.add("keyboard");
      this.keyboardInput.focus();
    } else {
      this.showKeyboard = false;
      this.root.classList.remove("keyboard");
      this.keyboardInput.blur();
      this.keyboardInput.value = "";
      this.keyboardNum = 0;
    }
  };

  App.prototype.onRender = function (batch) {
    const ctx = this._ctx || (this._ctx = this.canvas.getContext("2d", { alpha: false }));
    for (const { x, y, w, h, data } of batch.images) {
      const image = ctx.createImageData(w, h);
      image.data.set(data);
      ctx.putImageData(image, x, y);
    }
    if (batch.text.length) {
      ctx.save();
      ctx.font = "bold 13px Times New Roman";
      if (batch.clip) {
        const { x0, y0, x1, y1 } = batch.clip;
        ctx.beginPath();
        ctx.rect(x0, y0, x1 - x0, y1 - y0);
        ctx.clip();
      }
      for (const { x, y, text, color } of batch.text) {
        const r = (color >> 16) & 0xff,
          g = (color >> 8) & 0xff,
          b = color & 0xff;
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillText(text, x, y + 22);
      }
      ctx.restore();
    }
    // belt rendering (item quick-slots) omitted in this build for simplicity
  };

  // ---- input handling ----
  App.prototype.pointerLocked = function () {
    return document.pointerLockElement === this.canvas;
  };
  App.prototype.mousePos = function (e) {
    const rect = this.canvas.getBoundingClientRect();
    if (this.pointerLocked()) {
      this.cursorPos.x = Math.max(rect.left, Math.min(rect.right, this.cursorPos.x + e.movementX));
      this.cursorPos.y = Math.max(rect.top, Math.min(rect.bottom, this.cursorPos.y + e.movementY));
    } else {
      this.cursorPos = { x: e.clientX, y: e.clientY };
    }
    return {
      x: Math.max(0, Math.min(Math.round(((this.cursorPos.x - rect.left) / (rect.right - rect.left)) * 640), 639)),
      y: Math.max(0, Math.min(Math.round(((this.cursorPos.y - rect.top) / (rect.bottom - rect.top)) * 480), 479)),
    };
  };
  App.prototype.mouseButton = function (e) {
    switch (e.button) {
      case 0:
        return 1;
      case 1:
        return 4;
      case 2:
        return 2;
      case 3:
        return 5;
      case 4:
        return 6;
      default:
        return 1;
    }
  };
  App.prototype.eventMods = function (e) {
    return (e.shiftKey ? 1 : 0) + (e.ctrlKey ? 2 : 0) + (e.altKey ? 4 : 0);
  };

  App.prototype.attachGameEvents = function () {
    const self = this;

    document.addEventListener(
      "mousemove",
      (e) => {
        const { x, y } = self.mousePos(e);
        self.engine.event("DApi_Mouse", 0, 0, self.eventMods(e), x, y);
        e.preventDefault();
      },
      true
    );
    document.addEventListener(
      "mousedown",
      (e) => {
        if (e.target === self.keyboardInput) return;
        const { x, y } = self.mousePos(e);
        if (window.screen && window.innerHeight === window.screen.height && !self.pointerLocked()) {
          self.canvas.requestPointerLock && self.canvas.requestPointerLock();
        }
        self.engine.event("DApi_Mouse", 1, self.mouseButton(e), self.eventMods(e), x, y);
        e.preventDefault();
      },
      true
    );
    document.addEventListener(
      "mouseup",
      (e) => {
        const { x, y } = self.mousePos(e);
        self.engine.event("DApi_Mouse", 2, self.mouseButton(e), self.eventMods(e), x, y);
        if (e.target !== self.keyboardInput) e.preventDefault();
      },
      true
    );
    document.addEventListener(
      "contextmenu",
      (e) => {
        e.preventDefault();
      },
      true
    );

    document.addEventListener(
      "keydown",
      (e) => {
        self.engine.event("DApi_Key", 0, self.eventMods(e), e.keyCode);
        if (!self.showKeyboard && e.keyCode >= 32 && e.key.length === 1) {
          self.engine.event("DApi_Char", e.key.charCodeAt(0));
        } else if (e.keyCode === 8 || e.keyCode === 13) {
          self.engine.event("DApi_Char", e.keyCode);
        }
        self.clearKeySel();
        if (!self.showKeyboard) {
          if (e.keyCode === 8 || e.keyCode === 9 || (e.keyCode >= 112 && e.keyCode <= 119)) {
            e.preventDefault();
          }
        }
      },
      true
    );
    document.addEventListener(
      "keyup",
      (e) => {
        self.engine.event("DApi_Key", 1, self.eventMods(e), e.keyCode);
        self.clearKeySel();
      },
      true
    );

    document.addEventListener("pointerlockchange", () => {
      if (window.screen && window.innerHeight === window.screen.height && !self.pointerLocked()) {
        self.engine.event("DApi_Key", 0, 0, 27);
        self.engine.event("DApi_Key", 1, 0, 27);
      }
    });
    window.addEventListener("resize", () => {
      document.exitPointerLock && document.exitPointerLock();
    });

    this.keyboardInput.addEventListener("input", () => self.onKeyboardInput(0));
    this.keyboardInput.addEventListener("blur", () => self.onKeyboardInput(1));
  };

  App.prototype.clearKeySel = function () {
    if (this.showKeyboard) {
      const len = this.keyboardInput.value.length;
      this.keyboardInput.setSelectionRange(len, len);
    }
  };
  App.prototype.onKeyboardInput = function (flags) {
    if (!this.showKeyboard) return;
    const text = this.keyboardInput.value;
    let valid;
    if (this.maxKeyboard > 0) {
      valid = (text.match(/[\x20-\x7E]/g) || []).join("").substring(0, this.maxKeyboard);
    } else {
      const maxValue = -this.maxKeyboard;
      if (/^\d*$/.test(text)) {
        this.keyboardNum = Math.min(text.length ? parseInt(text, 10) : 0, maxValue);
      }
      valid = this.keyboardNum ? this.keyboardNum.toString() : "";
    }
    if (text !== valid) this.keyboardInput.value = valid;
    this.clearKeySel();
    this.engine.event("text", valid, flags);
  };

  window.addEventListener("DOMContentLoaded", () => {
    window.__diabloApp = new App();
  });
})();
