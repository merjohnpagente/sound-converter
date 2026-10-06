// Sound-to-Binary Converter - app logic (vanilla JS, no libraries)

// Show / hide warning message (page must not break on bad input)
function showWarning(msg) {
  var w = document.getElementById("warning");
  w.style.display = "block";
  w.textContent = msg;
}

function hideWarning() {
  var w = document.getElementById("warning");
  w.style.display = "none";
  w.textContent = "";
  var ids = ["freq", "amp", "samples", "bits"];
  for (var k = 0; k < ids.length; k++) {
    document.getElementById(ids[k]).classList.remove("invalid");
  }
}

function markInvalid(id) {
  document.getElementById(id).classList.add("invalid");
}

// Update only the status text so the speaker icon in #playStatus is kept
function setStatus(msg) {
  var s = document.getElementById("playStatusText");
  if (s) s.textContent = msg;
}

// Quick-fill preset: set the four inputs and convert (same math as typing)
function applyPreset(freq, amp, n, bits) {
  document.getElementById("freq").value = freq;
  document.getElementById("amp").value = amp;
  document.getElementById("samples").value = n;
  document.getElementById("bits").value = bits;
  convert();
  // Bring results into view (skip animation for reduced-motion users)
  try {
    var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("resultsCard").scrollIntoView(calm ? {} : { behavior: "smooth", block: "start" });
  } catch (e) {}
}

// Main convert: same math as required by the activity
function convert() {
  hideWarning();

  // Read raw strings so amplitude / frequency show exactly as typed
  var freqStr = document.getElementById("freq").value;
  var ampStr = document.getElementById("amp").value;
  var samplesStr = document.getElementById("samples").value;
  var bitsStr = document.getElementById("bits").value;

  var freq = parseFloat(freqStr);
  var amp = parseFloat(ampStr);
  var n = Number(samplesStr);
  var bits = Number(bitsStr);

  // Validation (show warning, do not break)
  if (isNaN(freq) || freq <= 0) {
    markInvalid("freq");
    showWarning("Warning: Frequency must be greater than 0.");
    return;
  }
  if (isNaN(amp) || amp < 0 || amp > 1) {
    markInvalid("amp");
    showWarning("Warning: Amplitude must be between 0 and 1.");
    return;
  }
  if (!Number.isInteger(n) || n < 2 || n > 64) {
    markInvalid("samples");
    showWarning("Warning: Samples must be a whole number from 2 to 64.");
    return;
  }
  if (!Number.isInteger(bits) || bits < 1 || bits > 8) {
    markInvalid("bits");
    showWarning("Warning: Bits must be a whole number from 1 to 8.");
    return;
  }

  // Math
  var periodMs = 1000 / freq;      // period in ms
  var wavelengthM = 343 / freq;    // wavelength in meters
  var periodText = periodMs.toFixed(2) + " ms";
  var wavelengthText;
  if (wavelengthM >= 1) {
    wavelengthText = wavelengthM.toFixed(2) + " m";
  } else {
    wavelengthText = (wavelengthM * 100).toFixed(1) + " cm";
  }
  var levels = Math.pow(2, bits);

  // Wave facts
  document.getElementById("factsText").innerHTML =
    "Amplitude: " + ampStr +
    "<br>Frequency: " + freqStr + " Hz" +
    "<br>Period: " + periodText +
    "<br>Wavelength: " + wavelengthText;
  document.getElementById("statAmp").textContent = ampStr;
  document.getElementById("statFreq").textContent = freqStr + " Hz";
  document.getElementById("statPeriod").textContent = periodText;
  document.getElementById("statWave").textContent = wavelengthText;

  // Loop through every sample
  var tbody = document.getElementById("resultBody");
  tbody.innerHTML = "";
  var binaryList = [];
  var heights = [];

  for (var i = 0; i < n; i++) {
    var timeMs = i * periodMs / n; // do NOT use frequency inside sine, use i / n only
    var height = amp * Math.sin(2 * Math.PI * i / n);
    var level = Math.round((height + 1) / 2 * (levels - 1)); // halfway rounds up
    var binary = level.toString(2).padStart(bits, "0");      // leading zeros
    binaryList.push(binary);
    heights.push(height);

    var tr = document.createElement("tr");
    tr.innerHTML =
      "<td>" + (i + 1) + "</td>" +
      "<td>" + timeMs.toFixed(2) + "</td>" +
      "<td>" + height.toFixed(2) + "</td>" +
      "<td>" + level + "</td>" +
      "<td class='mono'>" + binary + "</td>";
    tbody.appendChild(tr);
  }

  document.getElementById("binaryResult").textContent = binaryList.join(" ");
  document.getElementById("totalBits").innerHTML =
    "<strong>Total bits:</strong> " + (n * bits) + " (" + n + " x " + bits + ")";

  renderChips(binaryList, levels);
  drawWave(amp, heights);
}

// Shade chips: visual mirror of the graded one-line binary (graded line untouched).
// Darker orange means a higher level.
function renderChips(binaryList, levels) {
  var box = document.getElementById("bitChips");
  if (!box) return;
  box.innerHTML = "";
  for (var i = 0; i < binaryList.length; i++) {
    var lvl = parseInt(binaryList[i], 2);
    var alpha = 0.08 + 0.85 * (levels > 1 ? lvl / (levels - 1) : 0);
    var s = document.createElement("span");
    s.className = "chip";
    s.textContent = binaryList[i];
    s.title = "Sample " + (i + 1) + ", level " + lvl;
    s.style.backgroundColor = "rgba(255,106,61," + alpha.toFixed(2) + ")";
    box.appendChild(s);
  }
}

// Live volume meter: peak of the analyser buffer while a tone plays.
function updateMeter() {
  var fill = document.getElementById("volFill");
  if (!fill) return;
  var peak = 0;
  if (tonePlaying && analyser && liveBuf) {
    for (var i = 0; i < liveBuf.length; i += 4) {
      var a = Math.abs(liveBuf[i]);
      if (a > peak) peak = a;
    }
  }
  var pct = Math.min(100, (peak / 0.3) * 100);
  fill.style.width = pct.toFixed(1) + "%";
}

// Animated wave preview (visual aid only, does not change the graded math).
// The table is always a frozen snapshot at phase 0. The canvas scrolls with
// a phase offset so you can see the sound moving; dots ride the moving wave.
var waveAmp = 1;
var waveN = 4;
var wavePhase = 0;
var wavePlaying = true;
var waveRaf = null;
var waveActiveRow = -1;

// Live sound tap for the sound-reactive animation (visual aid only).
// While a tone plays, the analyser holds the real waveform; otherwise null
// and the canvas shows the synthetic scrolling preview.
var analyser = null;
var liveBuf = null;

// Pause-bars vs play-triangle paths for the animation toggle button (SVG, not emoji)
var ICON_PAUSE = "<path d=\"M7 5h4v14H7zM13 5h4v14h-4z\"/>";
var ICON_PLAY = "<path d=\"M8 5v14l11-7z\"/>";

function setAnimIcon(playing) {
  var icon = document.getElementById("animIcon");
  if (icon) icon.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
}

function drawWave(amp, heights) {
  waveAmp = amp;
  waveN = heights && heights.length ? heights.length : 4;
  waveActiveRow = -1;
  startWaveLoop();
}

// Size the canvas backing store for sharp rendering on high-DPI screens.
// Draw in a fixed 900x220 space; CSS (aspect-ratio) controls display size.
var WAVE_W = 900, WAVE_H = 220;

function waveCtx() {
  var c = document.getElementById("waveCanvas");
  if (!c) return null;
  var dpr = (window.devicePixelRatio || 1);
  if (dpr > 2) dpr = 2; // cap so low-end phones don't overwork
  var bw = Math.round(WAVE_W * dpr), bh = Math.round(WAVE_H * dpr);
  if (c.width !== bw || c.height !== bh) {
    c.width = bw;
    c.height = bh;
  }
  var ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx: ctx, W: WAVE_W, H: WAVE_H };
}

function drawWaveFrame(phase) {
  var w = waveCtx();
  if (!w) return;
  var ctx = w.ctx, W = w.W, H = w.H;
  var midY = H / 2, scale = H / 2 - 18;
  ctx.clearRect(0, 0, W, H);

  // LIVE MODE: draw the real playing sound instead of the preview.
  // Louder sound = taller wave; silent (amp 0) = flat line.
  if (tonePlaying && analyser && liveBuf) {
    drawLiveFrame(ctx, W, H, midY, scale);
    return;
  }
  // grid
  ctx.strokeStyle = "#24304d";
  ctx.lineWidth = 1;
  for (var x = 0; x < W; x += 45) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  // center axis
  ctx.strokeStyle = "#3b4a6b";
  ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(W, midY); ctx.stroke();

  // scrolling wave: one full period across canvas + moving phase
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (var px = 0; px <= W; px++) {
    var t = px / W;
    var h = waveAmp * Math.sin(2 * Math.PI * t + phase);
    var y = midY - h * scale;
    if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
  }
  ctx.stroke();

  // traveling cursor + sample dots riding the wave
  var cursorX = ((phase / (Math.PI * 2)) % 1 + 1) % 1 * W;
  ctx.strokeStyle = "#38bdf833";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cursorX, 0); ctx.lineTo(cursorX, H); ctx.stroke();

  var n = waveN || 4;
  var highlight = Math.floor(cursorX / W * n) % n;
  for (var i = 0; i < n; i++) {
    var sx = (i / n) * W;
    var sy = midY - (waveAmp * Math.sin(2 * Math.PI * (i / n) + phase)) * scale;
    var isHit = (i === highlight);
    ctx.fillStyle = isHit ? "#ffd166" : "#ff6a3d";
    ctx.beginPath(); ctx.arc(sx + 8, sy, isHit ? 10 : 7, 0, Math.PI * 2); ctx.fill();
    if (isHit) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx + 8, sy, 10, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px Arial";
    ctx.textAlign = "center";
    ctx.fillText(String(i + 1), sx + 8, sy + 3.5);
  }
  highlightTableRow(highlight);
  updateMeter();
}

// Draw one frame of the real live waveform from the analyser.
// Display scale is v / 0.3 (the full-volume peak): amplitude 1 fills the
// canvas, 0.5 is half height, and 0 is a flat line. Dots ride the live wave.
function drawLiveFrame(ctx, W, H, midY, scale) {
  analyser.getFloatTimeDomainData(liveBuf);
  var N = liveBuf.length;
  var v, y, idx;

  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (var px = 0; px <= W; px++) {
    idx = Math.floor(px / W * (N - 1));
    v = liveBuf[idx] / 0.3;
    if (v > 1) v = 1; else if (v < -1) v = -1;
    y = midY - v * scale;
    if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
  }
  ctx.stroke();

  var n = waveN || 4;
  for (var i = 0; i < n; i++) {
    var sx = (i / n) * W;
    var sidx = Math.floor((i / n) * (N - 1));
    var sv = liveBuf[sidx] / 0.3;
    if (sv > 1) sv = 1; else if (sv < -1) sv = -1;
    var sy = midY - sv * scale;
    ctx.fillStyle = "#ff6a3d";
    ctx.beginPath(); ctx.arc(sx + 8, sy, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px Arial";
    ctx.textAlign = "center";
    ctx.fillText(String(i + 1), sx + 8, sy + 3.5);
  }
  highlightTableRow(-1); // clear the travelling highlight while live
  updateMeter();
}

var CAPTION_PREVIEW = "Live preview — the wave scrolls and the dots ride it. The table is a frozen snapshot at phase 0.";
var CAPTION_LIVE = "Live sound — this is the real playing tone. Louder amplitude means a taller wave.";

function setCanvasCaption(live) {
  var c = document.getElementById("canvasCaption");
  if (c) c.textContent = live ? CAPTION_LIVE : CAPTION_PREVIEW;
}

function highlightTableRow(idx) {
  if (idx === waveActiveRow) return;
  waveActiveRow = idx;
  var tbody = document.getElementById("resultBody");
  if (!tbody || !tbody.rows) return;
  for (var r = 0; r < tbody.rows.length; r++) {
    if (r === idx) tbody.rows[r].classList.add("active-sample");
    else tbody.rows[r].classList.remove("active-sample");
  }
}

function waveLoop() {
  if (!wavePlaying) { waveRaf = null; return; }
  wavePhase += 0.08; // clearly visible scroll (visual only, not the real Hz)
  if (wavePhase > Math.PI * 2000) wavePhase -= Math.PI * 2000;
  drawWaveFrame(wavePhase);
  if (window.requestAnimationFrame) {
    waveRaf = requestAnimationFrame(waveLoop);
  } else {
    waveRaf = setTimeout(waveLoop, 33); // fallback for very old browsers
  }
}

function startWaveLoop() {
  drawWaveFrame(wavePhase);
  if (wavePlaying && !waveRaf) {
    if (window.requestAnimationFrame) waveRaf = requestAnimationFrame(waveLoop);
    else waveRaf = setTimeout(waveLoop, 33);
  }
}

function stopWaveLoop() {
  if (!waveRaf) return;
  if (window.cancelAnimationFrame) cancelAnimationFrame(waveRaf);
  else clearTimeout(waveRaf);
  waveRaf = null;
}

function toggleWave() {
  wavePlaying = !wavePlaying;
  var label = document.getElementById("animLabel");
  var btn = document.getElementById("animBtn");
  var live = document.getElementById("liveDot");
  if (label) label.textContent = wavePlaying ? "Pause animation" : "Play animation";
  if (btn) btn.setAttribute("aria-pressed", wavePlaying ? "true" : "false");
  if (live) live.classList.toggle("paused", !wavePlaying);
  setAnimIcon(wavePlaying);
  if (wavePlaying) {
    waveActiveRow = -1;
    if (!waveRaf) startWaveLoop();
  } else {
    stopWaveLoop();
  }
}

var copyTimer = null;

function copyBinary() {
  var txt = document.getElementById("binaryResult").textContent;
  if (!txt || txt === "—") {
    showWarning("Warning: Nothing to copy yet - press Convert first.");
    return;
  }
  if (!(navigator.clipboard && navigator.clipboard.writeText)) {
    showWarning("Warning: Copy is not supported in this browser - select the binary text manually.");
    return;
  }
  navigator.clipboard.writeText(txt).then(function () {
    // Flash feedback on the Copy button itself (leaves Play status alone)
    var btn = document.getElementById("copyBtn");
    if (!btn) return;
    if (copyTimer) clearTimeout(copyTimer);
    if (!btn.getAttribute("data-label")) {
      btn.setAttribute("data-label", btn.innerHTML);
    }
    btn.innerHTML = "Copied!";
    btn.classList.add("copied");
    copyTimer = setTimeout(function () {
      btn.innerHTML = btn.getAttribute("data-label");
      btn.classList.remove("copied");
      copyTimer = null;
    }, 1500);
  });
}

// Bonus: Play tone for 1 second with Web Audio API
var audioCtx = null;
var tonePlaying = false;

function playTone() {
  if (tonePlaying) return; // ignore rapid double-presses while a tone is playing
  var freq = parseFloat(document.getElementById("freq").value);
  if (isNaN(freq) || freq <= 0) {
    markInvalid("freq");
    showWarning("Warning: Frequency must be greater than 0 to play.");
    return;
  }
  if (freq < 20 || freq > 20000) {
    showWarning("Warning: Frequency " + freq + " Hz is outside hearing range (20-20000 Hz). Trying anyway.");
  } else {
    hideWarning();
  }
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Browsers start the context suspended; resume it on user gesture
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    // Volume follows the Amplitude input so loud input = loud sound.
    // (amp 0 is silent, amp 1 is loudest.)
    var ampIn = parseFloat(document.getElementById("amp").value);
    if (isNaN(ampIn) || ampIn < 0) ampIn = 0;
    if (ampIn > 1) ampIn = 1;
    var peak = 0.3 * ampIn;
    if (peak < 0.0001) peak = 0.0001;

    var osc = audioCtx.createOscillator();
    var gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

    var t = audioCtx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    gain.gain.setValueAtTime(peak, t + 0.9);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);

    // Tap the live sound for the animation: osc -> gain -> analyser -> speakers
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    liveBuf = new Float32Array(analyser.fftSize);

    osc.connect(gain);
    gain.connect(analyser);
    analyser.connect(audioCtx.destination);
    tonePlaying = true;
    osc.start(t);
    osc.stop(t + 1.05);

    setStatus("Playing " + freq + " Hz for 1 second...");
    setCanvasCaption(true);
    osc.onended = function () {
      try { osc.disconnect(); gain.disconnect(); analyser.disconnect(); } catch (e) {}
      tonePlaying = false;
      analyser = null; // back to synthetic preview mode
      liveBuf = null;
      setStatus("Done. Press Play to hear it again.");
      setCanvasCaption(false);
    };
  } catch (e) {
    tonePlaying = false;
    analyser = null;
    liveBuf = null;
    showWarning("Warning: Audio is not supported in this browser.");
  }
}

// UX: Enter key converts, auto-run default example on load
(function init() {
  var ids = ["freq", "amp", "samples", "bits"];
  for (var i = 0; i < ids.length; i++) {
    document.getElementById(ids[i]).addEventListener("keydown", function (e) {
      if (e.key === "Enter") convert();
    });
  }
  // Desktop shortcut: Ctrl/Cmd + Enter converts from anywhere on the page
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      convert();
    }
  });
  // Respect users who prefer less motion: start paused for them
  try {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      wavePlaying = false;
      var label = document.getElementById("animLabel");
      if (label) label.textContent = "Play animation";
      var btn = document.getElementById("animBtn");
      if (btn) btn.setAttribute("aria-pressed", "false");
      var live = document.getElementById("liveDot");
      if (live) live.classList.add("paused");
      setAnimIcon(false);
    }
  } catch (e) {}
  // Run the default example right away (defer scripts run before load,
  // but if load already fired we still want the wave to show + animate)
  function boot() { convert(); }
  if (document.readyState === "complete") boot();
  else window.addEventListener("load", boot);
})();
