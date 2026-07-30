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
    if (group.tier === "advanced") groupEl.classList.add("advanced-group");

    const header = document.createElement("div");
    header.className = "setting-group-header";
    header.textContent = group.group.toUpperCase();
    groupEl.appendChild(header);

    group.controls.forEach((control) => {
      state.values[control.id] = control.default;
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
    input.value = control.default;
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
      if (opt.value === control.default) optionEl.selected = true;
      select.appendChild(optionEl);
    });
    select.addEventListener("change", () => {
      state.values[control.id] = select.value;
      if (control.id === "preset") applyPreset(select.value);
      updateRunButton();
    });
    select.addEventListener("focus", () => showExplain(control));
    select.addEventListener("mouseenter", () => showExplain(control));
    controlWrap.appendChild(select);
  } else if (control.type === "toggle") {
    const toggle = document.createElement("div");
    toggle.className = "toggle" + (control.default ? " on" : "");
    toggle.tabIndex = 0;
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", String(control.default));
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
    input.value = control.default || "";
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
  updateRunButton();
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

  // quality (0-100 UI) -> Cloudinary q_ param (also 0-100, or q_auto)
  if (v.quality !== undefined && v.quality !== "") parts.push(`q_${v.quality}`);

  if (v.videoBitrate) parts.push(`br_${v.videoBitrate}k`);
  if (v.scale) parts.push(`h_${v.scale},c_limit`);
  if (v.fps) parts.push(`fps_${v.fps}`);

  if (v.videoCodec && v.videoCodec !== "auto") {
    const codecMap = { h264: "h264", h265: "h265", vp9: "vp9", vp8: "vp8", av1: "av1" };
    parts.push(`vc_${codecMap[v.videoCodec] || v.videoCodec}`);
  }

  if (v.audioBitrate) parts.push(`ac_${v.audioCodec && v.audioCodec !== "auto" ? v.audioCodec : "aac"},br_${v.audioBitrate}k`);
  if (v.audioSampleRate) parts.push(`af_${v.audioSampleRate}`);
  if (v.audioChannels) parts.push(`ac_${v.audioChannels === "1" ? "mono" : "stereo"}`);

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

    showProgress("Applying settings…", 90);

    const transformation = buildTransformation();
    const format = state.values.format || "mp4";
    const transformedUrl = buildDeliveryUrl(sign.cloud_name, uploadResult.public_id, uploadResult.resource_type, transformation, format);

    showProgress("Done", 100);
    showResult(transformedUrl, uploadResult);
  } catch (err) {
    showError(err.message || "Upload failed. Check your connection and try again.");
  }
});

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

function showProgress(text, pct) {
  document.getElementById("progress-text").textContent = text;
  document.getElementById("progress-fill").style.width = pct + "%";
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
