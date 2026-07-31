/**
 * app.js — wires up the console UI: renders settings from presets.js,
 * handles file selection, builds a Cloudinary transformation string
 * from current control values, requests a signed upload from the
 * Cloudflare Worker, uploads, and shows the result + 30-min countdown.
 *
 * >>> CONFIGURE THIS <<<
 */
const WORKER_URL = "https://worker617.artful617.workers.dev";

const state = {
  file: null,
  values: {}, // control id -> current value
};

/* ---------------------------------------------------------
   RENDER SETTINGS
--------------------------------------------------------- */
function renderSettings() {
  const grid = document.getElementById("settings-grid");
  grid.innerHTML = "";

  SETTINGS_SCHEMA.forEach((group) => {
    const groupEl = document.createElement("div");
    groupEl.className = "setting-group" + (group.tier === "advanced" ? " advanced-only" : "");
    groupEl.dataset.group = group.group;
    if (group.tier === "advanced") groupEl.classList.add("advanced-group");

    const header = document.createElement("div");
    header.className = "setting-group-header";
    header.textContent = group.group.toUpperCase();
    groupEl.appendChild(header);

    group.controls.forEach((control) => {
      // Only seed the default on first render — re-renders (e.g. after
      // applying a preset) must NOT stomp on values that were just set.
      if (!(control.id in state.values)) {
        state.values[control.id] = control.default;
      }
      const row = buildControlRow(control, group.tier);
      groupEl.appendChild(row);
    });

    grid.appendChild(groupEl);
  });

  // Advanced-only groups hidden via CSS class on body, not per-row,
  // for cleaner toggling — but rows also carry the class as a fallback.
  document.querySelectorAll(".advanced-group").forEach((el) => {
    el.classList.add("setting-row", "advanced-only");
    el.style.display = document.body.classList.contains("mode-advanced") ? "block" : "none";
  });
}

function buildControlRow(control, tier) {
  const row = document.createElement("div");
  row.className = "setting-row" + (tier === "advanced" ? " advanced-only" : "");
  row.dataset.controlId = control.id;

  const name = document.createElement("div");
  name.className = "setting-name";
  name.textContent = control.label;
  row.appendChild(name);

  const controlWrap = document.createElement("div");
  const valueDisplay = document.createElement("div");
  valueDisplay.className = "setting-value";

  const updateValueDisplay = () => {
    const v = state.values[control.id];
    if (control.type === "toggle") {
      valueDisplay.textContent = v ? "ON" : "OFF";
    } else if (control.type === "range") {
      valueDisplay.textContent = (v === "" || v === undefined ? "—" : v) + (control.unit || "");
    } else if (control.type === "select") {
      const opt = control.options.find((o) => o.value === v);
      valueDisplay.textContent = ""; // select shows its own text, keep value cell empty
    } else {
      valueDisplay.textContent = "";
    }
  };

  if (control.type === "range") {
    const input = document.createElement("input");
    input.type = "range";
    input.min = control.min;
    input.max = control.max;
    input.step = control.step;
    input.value = state.values[control.id] ?? control.default;
    input.addEventListener("input", () => {
      state.values[control.id] = Number(input.value);
      updateValueDisplay();
      updateRunButton();
    });
    input.addEventListener("focus", () => showExplain(control));
    input.addEventListener("mouseenter", () => showExplain(control));
    controlWrap.appendChild(input);
  } else if (control.type === "select") {
    const select = document.createElement("select");
    control.options.forEach((opt) => {
      const optionEl = document.createElement("option");
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      if (opt.value === (state.values[control.id] ?? control.default)) optionEl.selected = true;
      select.appendChild(optionEl);
    });
    controlWrap.appendChild(select);

    // Optional custom-value input, shown only when "custom" is selected.
    let customInput = null;
    if (control.allowCustom) {
      customInput = document.createElement("input");
      customInput.type = "number";
      customInput.min = control.customMin ?? 0;
      customInput.max = control.customMax ?? 100000;
      customInput.placeholder = "kbps";
      customInput.style.marginTop = "6px";
      customInput.hidden = true;
      customInput.addEventListener("input", () => {
        if (customInput.value !== "") {
          state.values[control.id] = customInput.value;
          updateRunButton();
        }
      });
      controlWrap.appendChild(customInput);
    }

    select.addEventListener("change", () => {
      if (control.allowCustom && select.value === "custom") {
        customInput.hidden = false;
        customInput.focus();
        // Don't overwrite state.values yet — wait for a real number.
      } else {
        if (customInput) customInput.hidden = true;
        state.values[control.id] = select.value;
      }
      if (control.id === "preset") applyPreset(select.value);
      if (control.id === "format") syncAudioBitrateAvailability();
      updateRunButton();
    });
    select.addEventListener("focus", () => showExplain(control));
    select.addEventListener("mouseenter", () => showExplain(control));
  } else if (control.type === "toggle") {
    const toggle = document.createElement("div");
    const currentOn = state.values[control.id] ?? control.default;
    toggle.className = "toggle" + (currentOn ? " on" : "");
    toggle.tabIndex = 0;
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", String(currentOn));
    const flip = () => {
      const on = !toggle.classList.contains("on");
      toggle.classList.toggle("on", on);
      toggle.setAttribute("aria-checked", String(on));
      state.values[control.id] = on;
      updateValueDisplay();
      updateRunButton();
    };
    toggle.addEventListener("click", flip);
    toggle.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); }
    });
    toggle.addEventListener("focus", () => showExplain(control));
    toggle.addEventListener("mouseenter", () => showExplain(control));
    controlWrap.appendChild(toggle);
  } else if (control.type === "text") {
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = control.placeholder || "";
    input.value = state.values[control.id] ?? control.default ?? "";
    input.addEventListener("input", () => {
      state.values[control.id] = input.value;
      updateRunButton();
    });
    input.addEventListener("focus", () => showExplain(control));
    input.addEventListener("mouseenter", () => showExplain(control));
    controlWrap.appendChild(input);
  }

  row.appendChild(controlWrap);
  updateValueDisplay();
  row.appendChild(valueDisplay);

  row.addEventListener("mouseenter", () => showExplain(control));

  return row;
}

function applyPreset(presetKey) {
  const bundle = PRESET_VALUES[presetKey];
  if (!bundle) return;
  Object.entries(bundle).forEach(([id, val]) => {
    state.values[id] = val;
  });
  renderSettings(); // re-render to reflect bundled values in controls
  syncModeClass();
  syncAudioBitrateAvailability();
}

// Audio bitrate can only be set independently from video bitrate for
// audio-only output formats (mp3/wav/flac/aac). For video formats,
// Cloudinary's simple br_ parameter is shared between streams and the
// video bitrate always wins, so the control would silently do nothing —
// better to disable it and say why than let it look like it's working.
const AUDIO_ONLY_FORMATS = ["mp3", "wav", "flac", "aac"];

function syncAudioBitrateAvailability() {
  const row = document.querySelector('.setting-row[data-control-id="audioBitrate"]');
  if (!row) return;
  const isAudioOnly = AUDIO_ONLY_FORMATS.includes(state.values.format);

  const select = row.querySelector("select");
  const customInput = row.querySelector('input[type="number"]');
  row.classList.toggle("row-disabled", !isAudioOnly);
  if (select) select.disabled = !isAudioOnly;
  if (customInput) customInput.disabled = !isAudioOnly;

  row.title = isAudioOnly
    ? ""
    : "Only applies to audio-only output formats (MP3/WAV/FLAC/AAC) — video bitrate takes priority for video formats.";

  // Hide the entire video-only groups too — showing "Resolution" or
  // "Video bitrate" controls for an mp3 output is misleading since
  // there's no video stream for them to apply to at all.
  const VIDEO_GROUP_NAMES = ["Video", "Video — Advanced"];
  document.querySelectorAll(".setting-group").forEach((groupEl) => {
    if (VIDEO_GROUP_NAMES.includes(groupEl.dataset.group)) {
      groupEl.classList.toggle("group-hidden", isAudioOnly);
    }
  });
}

/* ---------------------------------------------------------
   EXPLAIN PANEL
--------------------------------------------------------- */
function showExplain(control) {
  if (!control.explain) return;
  document.getElementById("explain-title").textContent = control.explain.title;
  document.getElementById("explain-body").textContent = control.explain.body;
  const flagEl = document.getElementById("explain-flag");
  const flagCode = document.getElementById("explain-flag-code");
  if (control.explain.flag) {
    flagEl.hidden = false;
    flagCode.textContent = control.explain.flag;
  } else {
    flagEl.hidden = true;
  }
}

/* ---------------------------------------------------------
   MODE SWITCH (basic / advanced)
--------------------------------------------------------- */
function syncModeClass() {
  document.querySelectorAll(".advanced-only").forEach((el) => {
    el.style.display = document.body.classList.contains("mode-advanced")
      ? (el.classList.contains("setting-group") ? "block" : "grid")
      : "none";
  });
}

document.getElementById("mode-basic").addEventListener("click", () => {
  document.body.classList.remove("mode-advanced");
  setModeButtons("basic");
  syncModeClass();
});
document.getElementById("mode-advanced").addEventListener("click", () => {
  document.body.classList.add("mode-advanced");
  setModeButtons("advanced");
  syncModeClass();
});

function setModeButtons(active) {
  const basic = document.getElementById("mode-basic");
  const advanced = document.getElementById("mode-advanced");
  basic.classList.toggle("active", active === "basic");
  advanced.classList.toggle("active", active === "advanced");
  basic.setAttribute("aria-selected", String(active === "basic"));
  advanced.setAttribute("aria-selected", String(active === "advanced"));
}

/* ---------------------------------------------------------
   FILE INPUT
--------------------------------------------------------- */
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") fileInput.click();
});
dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  if (e.dataTransfer.files.length) setFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files.length) setFile(fileInput.files[0]);
});

document.getElementById("clear-file").addEventListener("click", (e) => {
  e.stopPropagation();
  state.file = null;
  fileInput.value = "";
  document.getElementById("dropzone-empty").hidden = false;
  document.getElementById("dropzone-filled").hidden = true;
  updateRunButton();
});

function setFile(file) {
  state.file = file;
  document.getElementById("dropzone-empty").hidden = true;
  document.getElementById("dropzone-filled").hidden = false;
  document.getElementById("file-name").textContent = file.name;
  const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
  document.getElementById("file-details").textContent = `${sizeMB} MB · ${file.type || "unknown type"}`;
  document.getElementById("file-type-icon").textContent = file.type.startsWith("audio") ? "♪" : "▶";

  autoSelectFormat(file);
  updateRunButton();
}

// Map common MIME types / extensions to one of our output format options,
// so dropping an mp3 defaults the output format select to mp3, etc.
// Only auto-switches if the dropped file's type maps to a real option —
// leaves the format alone otherwise (e.g. unknown/exotic types).
const FORMAT_MIME_MAP = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/aac": "aac",
  "audio/mp4": "aac",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};
const FORMAT_EXT_MAP = {
  mp3: "mp3", wav: "wav", flac: "flac", aac: "aac",
  mp4: "mp4", webm: "webm", mov: "mov", m4a: "aac",
};

function autoSelectFormat(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const detected = FORMAT_MIME_MAP[file.type] || FORMAT_EXT_MAP[ext];
  if (!detected) return;

  state.values.format = detected;

  // Reflect it in the actual <select> if it's already rendered, and
  // refresh anything that depends on the format (audio bitrate gating).
  const row = document.querySelector('.setting-row[data-control-id="format"]');
  const select = row ? row.querySelector("select") : null;
  if (select) select.value = detected;
  syncAudioBitrateAvailability();
}

function updateRunButton() {
  const btn = document.getElementById("run-btn");
  btn.disabled = !state.file;
  document.getElementById("run-cost-est").textContent = state.file
    ? `${state.values.format || "mp4"} · ${state.values.quality ?? 65}% quality`
    : "Select a file to continue";
}

/* ---------------------------------------------------------
   BUILD CLOUDINARY TRANSFORMATION STRING
--------------------------------------------------------- */
function buildTransformation() {
  const v = state.values;
  const parts = [];
  const isAudioOnlyFormat = ["mp3", "wav", "flac", "aac"].includes(v.format);

  // quality (0-100 UI) -> Cloudinary q_ param (also 0-100, or q_auto)
  if (v.quality !== undefined && v.quality !== "") parts.push(`q_${v.quality}`);

  // Bitrate: Cloudinary's br_av is officially "not supported by our SDKs"
  // and its hash-style syntax is fragile over HTTP. Simplest robust
  // approach: use a single br_ value, which Cloudinary applies to
  // whichever stream(s) actually exist. For audio-only output formats
  // there IS no video stream, so we must use the audio bitrate here —
  // otherwise the leftover default video bitrate silently wins every time.
  const audioBitrateValue = v.audioBitrate && v.audioBitrate !== "custom" ? v.audioBitrate : null;

  if (isAudioOnlyFormat) {
    if (audioBitrateValue) parts.push(`br_${audioBitrateValue}k`);
  } else if (v.videoBitrate) {
    parts.push(`br_${v.videoBitrate}k`);
  } else if (audioBitrateValue) {
    parts.push(`br_${audioBitrateValue}k`);
  }

  if (!isAudioOnlyFormat) {
    if (v.scale) parts.push(`h_${v.scale},c_limit`);
    if (v.fps) parts.push(`fps_${v.fps}`);

    if (v.videoCodec && v.videoCodec !== "auto") {
      const codecMap = { h264: "h264", h265: "h265", vp9: "vp9", vp8: "vp8", av1: "av1" };
      parts.push(`vc_${codecMap[v.videoCodec] || v.videoCodec}`);
    }
  }

  // Audio codec is its own param — no bitrate suffix, that caused the
  // earlier "Unsupported codec aac:128k" 400.
  if (v.audioCodec && v.audioCodec !== "auto") {
    parts.push(`ac_${v.audioCodec}`);
  }

  if (v.audioSampleRate) parts.push(`af_${v.audioSampleRate}`);
  // Note: forcing mono/stereo isn't a simple named Cloudinary param —
  // omitted, since it was previously colliding with ac_ anyway.

  if (v.trimStart) parts.push(`so_${v.trimStart}`);
  if (v.trimEnd) parts.push(`eo_${v.trimEnd}`);

  if (v.denoise) parts.push(`e_improve`);
  if (v.sharpen) parts.push(`e_sharpen:${v.sharpen}`);

  return parts.join(",");
}

/* ---------------------------------------------------------
   UPLOAD + PROCESS FLOW
--------------------------------------------------------- */
let countdownInterval = null;

document.getElementById("run-btn").addEventListener("click", async () => {
  if (!state.file) return;
  resetOutputPanels();

  const isAudio = state.file.type.startsWith("audio") || ["mp3", "wav", "flac", "aac"].includes(state.values.format);
  const resourceType = isAudio ? "video" : "video"; // Cloudinary treats audio-only under "video" resource type for transformations

  showProgress("Requesting secure upload slot…", 5);

  try {
    const signRes = await fetch(`${WORKER_URL}/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource_type: resourceType }),
    });
    if (!signRes.ok) throw new Error("Could not get an upload authorization from the server.");
    const sign = await signRes.json();

    showProgress("Uploading…", 15);

    const formData = new FormData();
    formData.append("file", state.file);
    formData.append("api_key", sign.api_key);
    formData.append("timestamp", sign.timestamp);
    formData.append("signature", sign.signature);
    formData.append("public_id", sign.public_id);
    formData.append("tags", sign.tags);

    const uploadUrl = `https://api.cloudinary.com/v1_1/${sign.cloud_name}/${sign.resource_type}/upload`;

    const uploadResult = await uploadWithProgress(uploadUrl, formData, (pct) => {
      showProgress("Uploading…", 15 + pct * 0.55);
    });

    showProgress("Registering for auto-deletion…", 75);

    await fetch(`${WORKER_URL}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        public_id: uploadResult.public_id,
        resource_type: uploadResult.resource_type,
      }),
    });

    const transformation = buildTransformation();
    const format = state.values.format || "mp4";
    const transformedUrl = buildDeliveryUrl(sign.cloud_name, uploadResult.public_id, uploadResult.resource_type, transformation, format);

    // Cloudinary doesn't actually transcode on-the-fly URLs until they're
    // first requested — the URL existing is not the same as the file being
    // ready. Poll it ourselves so the progress bar reflects real encoding
    // time instead of lying and saying "Done" before any work has happened.
    await waitForTransformationReady(transformedUrl);

    showProgress("Done", 100);
    showResult(transformedUrl, uploadResult);
  } catch (err) {
    showError(err.message || "Upload failed. Check your connection and try again.");
  }
});

// Polls the Cloudinary delivery URL with HEAD requests until it resolves
// (200 = encoding finished and cached) or we give up. Cloudinary holds the
// response open on the very first request while it transcodes, so a HEAD
// request effectively "waits" for the encode — we just also want to keep
// the UI honest and responsive while that's happening, and recover if the
// browser/connection drops that long-held request.
function waitForTransformationReady(url, { timeoutMs = 10 * 60 * 1000, pollIntervalMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const describeElapsed = () => {
      const secs = Math.round((Date.now() - startedAt) / 1000);
      return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
    };

    // Progress here is inherently a guess — Cloudinary gives no % — so we
    // creep the bar toward (but never reach) 99% the longer this takes,
    // rather than freezing at one number or falsely hitting 100 early.
    const updateBar = () => {
      const elapsed = Date.now() - startedAt;
      const pct = 90 + 9 * (1 - Math.exp(-elapsed / 20000)); // approaches 99
      showProgress(`Encoding… (${describeElapsed()} elapsed)`, pct, true);
    };

    const attempt = () => {
      if (Date.now() - startedAt > timeoutMs) {
        fail(new Error("Encoding is taking much longer than expected. Your file may still finish — try the direct link again in a minute, or reduce how extreme your settings are (e.g. raise a very low bitrate)."));
        return;
      }
      updateBar();

      fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: { Range: "bytes=0-0" }, // we only need to confirm readiness, not download the whole file
      })
        .then((res) => {
          // 200 (full content) or 206 (partial content, range honored) both
          // mean Cloudinary actually served real transcoded bytes — that's
          // the only reliable signal the encode is done. A HEAD request can
          // return 200 immediately without Cloudinary having done the work.
          if (res.ok || res.status === 206) {
            succeed();
          } else if (res.status === 423 || res.status === 202) {
            setTimeout(attempt, pollIntervalMs);
          } else {
            fail(new Error(`Encoding failed (server returned ${res.status}). Try adjusting your settings.`));
          }
        })
        .catch(() => {
          setTimeout(attempt, pollIntervalMs);
        });
    };

    attempt();
  });
}

function uploadWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error("Cloudinary upload failed (" + xhr.status + ")"));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(formData);
  });
}

function buildDeliveryUrl(cloudName, publicId, resourceType, transformation, format) {
  const base = `https://res.cloudinary.com/${cloudName}/${resourceType}/upload`;
  const t = transformation ? `${transformation}/` : "";
  return `${base}/${t}${publicId}.${format}`;
}

/* ---------------------------------------------------------
   OUTPUT PANEL STATES
--------------------------------------------------------- */
function resetOutputPanels() {
  document.getElementById("progress-wrap").hidden = false;
  document.getElementById("result-card").hidden = true;
  document.getElementById("error-card").hidden = true;
  document.getElementById("run-btn").disabled = true;
  if (countdownInterval) clearInterval(countdownInterval);
}

function showProgress(text, pct, isEncoding = false) {
  document.getElementById("progress-text").textContent = text;
  const fill = document.getElementById("progress-fill");
  fill.style.width = pct + "%";
  fill.classList.toggle("is-encoding", isEncoding);
}

function showResult(url, uploadResult) {
  document.getElementById("progress-wrap").hidden = true;
  document.getElementById("result-card").hidden = false;
  document.getElementById("run-btn").disabled = false;

  document.getElementById("download-link").href = url;
  document.getElementById("result-size").textContent = uploadResult.bytes
    ? `${(uploadResult.bytes / (1024 * 1024)).toFixed(2)} MB output`
    : "Ready";

  startCountdown(30 * 60);

  // If signed in (see account.js), save this to "My Files" so it's not
  // lost on refresh — safe to skip silently for anonymous users, since
  // window.FFAccount only exists once account.js has loaded and the
  // save itself is a no-op when nobody's signed in.
  if (window.FFAccount) {
    window.FFAccount.saveFileRecord({
      url,
      filename: state.file ? state.file.name : "dosya",
      format: state.values.format || "mp4",
      sizeBytes: uploadResult.bytes || null,
    });
  }
}

function showError(message) {
  document.getElementById("progress-wrap").hidden = true;
  document.getElementById("error-card").hidden = false;
  document.getElementById("error-body").textContent = message;
  document.getElementById("run-btn").disabled = false;
}

function startCountdown(totalSeconds) {
  let remaining = totalSeconds;
  const el = document.getElementById("countdown-text");
  const tick = () => {
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    el.textContent = `Deletes automatically in ${m}:${String(s).padStart(2, "0")}`;
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      el.textContent = "Deleted — this link no longer works.";
    }
    remaining--;
  };
  tick();
  countdownInterval = setInterval(tick, 1000);
}

/* ---------------------------------------------------------
   INIT
--------------------------------------------------------- */
renderSettings();
syncModeClass();
syncAudioBitrateAvailability();
