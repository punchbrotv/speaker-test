const state = {
  running: false,
  mode: "white",
  channel: "both",
  volumeDb: -18,
  toneFrequency: 1000,
  sweepStart: 20,
  sweepEnd: 20000,
  sweepDuration: 12,
  logSweep: true,
  loopSweep: false,
};

const defaults = { ...state };
const els = {
  toggleAudio: document.querySelector("#toggleAudio"),
  toggleLabel: document.querySelector("#toggleLabel"),
  panicButton: document.querySelector("#panicButton"),
  statusText: document.querySelector("#statusText"),
  modeButtons: [...document.querySelectorAll("[data-mode]")],
  channelButtons: [...document.querySelectorAll("[data-channel]")],
  volumeSlider: document.querySelector("#volumeSlider"),
  volumeReadout: document.querySelector("#volumeReadout"),
  toneFrequency: document.querySelector("#toneFrequency"),
  toneReadout: document.querySelector("#toneReadout"),
  sweepStart: document.querySelector("#sweepStart"),
  sweepEnd: document.querySelector("#sweepEnd"),
  sweepDuration: document.querySelector("#sweepDuration"),
  sweepReadout: document.querySelector("#sweepReadout"),
  logSweep: document.querySelector("#logSweep"),
  loopSweep: document.querySelector("#loopSweep"),
  scopeTitle: document.querySelector("#scopeTitle"),
  scopeMeta: document.querySelector("#scopeMeta"),
  sweepProgress: document.querySelector("#sweepProgress"),
  analyzerCanvas: document.querySelector("#analyzerCanvas"),
  leftMeter: document.querySelector("#leftMeter"),
  rightMeter: document.querySelector("#rightMeter"),
  micMeter: document.querySelector("#micMeter"),
  leftDb: document.querySelector("#leftDb"),
  rightDb: document.querySelector("#rightDb"),
  micDb: document.querySelector("#micDb"),
  micButton: document.querySelector("#micButton"),
  identifyLeft: document.querySelector("#identifyLeft"),
  identifyRight: document.querySelector("#identifyRight"),
  polarityPulse: document.querySelector("#polarityPulse"),
  resetSettings: document.querySelector("#resetSettings"),
};

let audio = null;
let mic = null;
let animationFrame = 0;
let alternateTimer = 0;
let sweepTimer = 0;
let activeSweepStart = 0;

function createAudioGraph() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContext();
  const master = context.createGain();
  const leftGain = context.createGain();
  const rightGain = context.createGain();
  const merger = context.createChannelMerger(2);
  const analyser = context.createAnalyser();
  const splitter = context.createChannelSplitter(2);
  const leftAnalyser = context.createAnalyser();
  const rightAnalyser = context.createAnalyser();

  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0.84;
  leftAnalyser.fftSize = 2048;
  rightAnalyser.fftSize = 2048;

  master.gain.value = dbToGain(state.volumeDb);
  leftGain.connect(merger, 0, 0);
  rightGain.connect(merger, 0, 1);
  merger.connect(master);
  master.connect(analyser);
  master.connect(splitter);
  splitter.connect(leftAnalyser, 0);
  splitter.connect(rightAnalyser, 1);
  master.connect(context.destination);

  return {
    context,
    master,
    leftGain,
    rightGain,
    analyser,
    leftAnalyser,
    rightAnalyser,
    source: null,
    sourceGain: null,
    sourceKind: "",
  };
}

function dbToGain(db) {
  return Math.pow(10, db / 20);
}

function gainToDb(gain) {
  if (!Number.isFinite(gain) || gain <= 0.000001) return -Infinity;
  return 20 * Math.log10(gain);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatFrequency(value) {
  const frequency = Math.round(value);
  return frequency >= 1000 ? `${trimNumber(frequency / 1000)} kHz` : `${frequency} Hz`;
}

function trimNumber(value) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function createNoiseBuffer(context, kind) {
  const seconds = 2;
  const length = context.sampleRate * seconds;
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const output = buffer.getChannelData(0);

  if (kind === "pink") {
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;

    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  } else {
    for (let i = 0; i < length; i += 1) {
      output[i] = (Math.random() * 2 - 1) * 0.72;
    }
  }

  return buffer;
}

function clearSource() {
  window.clearInterval(alternateTimer);
  window.clearTimeout(sweepTimer);
  alternateTimer = 0;
  sweepTimer = 0;
  activeSweepStart = 0;

  if (!audio) return;
  if (audio.source) {
    try {
      audio.source.stop();
    } catch {
      // Source may already have stopped.
    }
    audio.source.disconnect();
    audio.source = null;
  }
  if (audio.sourceGain) {
    audio.sourceGain.disconnect();
    audio.sourceGain = null;
  }
  audio.sourceKind = "";
}

function connectMonoSource(source, gainValue = 1) {
  const sourceGain = audio.context.createGain();
  sourceGain.gain.value = gainValue;
  source.connect(sourceGain);
  sourceGain.connect(audio.leftGain);
  sourceGain.connect(audio.rightGain);
  audio.sourceGain = sourceGain;
  audio.source = source;
}

function startNoise(kind) {
  const source = audio.context.createBufferSource();
  source.buffer = createNoiseBuffer(audio.context, kind);
  source.loop = true;
  connectMonoSource(source);
  source.start();
  audio.sourceKind = kind;
}

function startTone() {
  const oscillator = audio.context.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.value = state.toneFrequency;
  connectMonoSource(oscillator, 0.82);
  oscillator.start();
  audio.sourceKind = "tone";
}

function startSweep() {
  const oscillator = audio.context.createOscillator();
  const now = audio.context.currentTime;
  const start = clamp(state.sweepStart, 10, 22000);
  const end = clamp(state.sweepEnd, 10, 22000);
  const duration = clamp(state.sweepDuration, 1, 120);

  oscillator.type = "sine";
  oscillator.frequency.cancelScheduledValues(now);
  oscillator.frequency.setValueAtTime(start, now);
  if (state.logSweep && start > 0 && end > 0) {
    oscillator.frequency.exponentialRampToValueAtTime(end, now + duration);
  } else {
    oscillator.frequency.linearRampToValueAtTime(end, now + duration);
  }

  connectMonoSource(oscillator, 0.82);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.04);
  oscillator.onended = () => {
    if (!audio || audio.source !== oscillator) return;
    if (state.running && state.mode === "sweep" && state.loopSweep) {
      clearSource();
      startSweep();
      applyChannelRouting();
    } else if (state.running && state.mode === "sweep") {
      stopAudio();
    }
  };
  activeSweepStart = performance.now();
  audio.sourceKind = "sweep";
}

async function startAudio() {
  if (!audio) audio = createAudioGraph();
  if (audio.context.state === "suspended") await audio.context.resume();
  clearSource();
  state.running = true;

  if (state.mode === "tone") startTone();
  else if (state.mode === "sweep") startSweep();
  else startNoise(state.mode);

  applyLevel();
  applyChannelRouting();
  updateUi();
  startDrawing();
  persistState();
}

function stopAudio() {
  if (!audio) return;
  state.running = false;
  clearSource();
  rampGain(audio.leftGain.gain, 0);
  rampGain(audio.rightGain.gain, 0);
  updateUi();
  persistState();
}

function rampGain(param, value) {
  const now = audio.context.currentTime;
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, 0.018);
}

function applyLevel() {
  if (!audio) return;
  const now = audio.context.currentTime;
  audio.master.gain.cancelScheduledValues(now);
  audio.master.gain.setTargetAtTime(dbToGain(state.volumeDb), now, 0.018);
}

function applyChannelRouting() {
  if (!audio) return;
  window.clearInterval(alternateTimer);
  alternateTimer = 0;

  const setChannels = (left, right) => {
    rampGain(audio.leftGain.gain, left);
    rampGain(audio.rightGain.gain, right);
  };

  if (!state.running) {
    setChannels(0, 0);
    return;
  }

  if (state.channel === "left") setChannels(1, 0);
  else if (state.channel === "right") setChannels(0, 1);
  else if (state.channel === "alternate") {
    let leftActive = true;
    setChannels(1, 0);
    alternateTimer = window.setInterval(() => {
      leftActive = !leftActive;
      setChannels(leftActive ? 1 : 0, leftActive ? 0 : 1);
      updateScopeMeta();
    }, 1000);
  } else {
    setChannels(1, 1);
  }
}

function setMode(mode) {
  state.mode = mode;
  if (state.running) startAudio();
  updateUi();
  persistState();
}

function setChannel(channel) {
  state.channel = channel;
  applyChannelRouting();
  updateUi();
  persistState();
}

function oneShotPing(channel) {
  if (!audio) audio = createAudioGraph();
  audio.context.resume();
  const now = audio.context.currentTime;
  const oscillator = audio.context.createOscillator();
  const envelope = audio.context.createGain();
  const merger = audio.context.createChannelMerger(2);
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, now);
  oscillator.frequency.exponentialRampToValueAtTime(1320, now + 0.14);
  envelope.gain.setValueAtTime(0.0001, now);
  envelope.gain.exponentialRampToValueAtTime(dbToGain(Math.min(state.volumeDb, -12)), now + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
  oscillator.connect(envelope);
  envelope.connect(merger, 0, channel === "left" ? 0 : 1);
  merger.connect(audio.master);
  oscillator.start(now);
  oscillator.stop(now + 0.28);
  oscillator.onended = () => {
    envelope.disconnect();
    merger.disconnect();
  };
  setStatus(`Ping ${channel}`);
}

function polarityPulse() {
  if (!audio) audio = createAudioGraph();
  audio.context.resume();
  const now = audio.context.currentTime;
  const length = Math.floor(audio.context.sampleRate * 0.09);
  const buffer = audio.context.createBuffer(1, length, audio.context.sampleRate);
  const data = buffer.getChannelData(0);
  const merger = audio.context.createChannelMerger(2);
  for (let i = 0; i < length; i += 1) {
    const t = i / audio.context.sampleRate;
    const decay = Math.exp(-t * 62);
    data[i] = (i < length * 0.16 ? 1 : -0.55) * decay;
  }
  const source = audio.context.createBufferSource();
  const envelope = audio.context.createGain();
  source.buffer = buffer;
  envelope.gain.value = dbToGain(Math.min(state.volumeDb, -10));
  source.connect(envelope);
  envelope.connect(merger, 0, 0);
  envelope.connect(merger, 0, 1);
  merger.connect(audio.master);
  source.start(now);
  source.onended = () => {
    envelope.disconnect();
    merger.disconnect();
  };
  setStatus("Polarity pulse");
}

async function toggleMicMeter() {
  if (mic) {
    mic.stream.getTracks().forEach((track) => track.stop());
    mic.source.disconnect();
    mic = null;
    els.micButton.textContent = "Enable mic meter";
    els.micDb.textContent = "Off";
    els.micMeter.style.width = "0%";
    return;
  }

  try {
    if (!audio) audio = createAudioGraph();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const source = audio.context.createMediaStreamSource(stream);
    const analyser = audio.context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    mic = { stream, source, analyser, data: new Float32Array(analyser.fftSize) };
    els.micButton.textContent = "Disable mic meter";
    startDrawing();
  } catch (error) {
    els.micDb.textContent = "Unavailable";
    setStatus(error.name === "NotAllowedError" ? "Mic permission denied" : "Mic unavailable");
  }
}

function startDrawing() {
  if (animationFrame) return;
  draw();
}

function draw() {
  animationFrame = window.requestAnimationFrame(draw);
  drawMeters();
  drawAnalyzer();
  updateSweepProgress();
}

function drawMeters() {
  const left = getAnalyserDb(audio?.leftAnalyser);
  const right = getAnalyserDb(audio?.rightAnalyser);
  setMeter(els.leftMeter, els.leftDb, left);
  setMeter(els.rightMeter, els.rightDb, right);

  if (mic) {
    const micDb = getAnalyserDb(mic.analyser);
    setMeter(els.micMeter, els.micDb, micDb);
  }
}

function getAnalyserDb(analyser) {
  if (!analyser) return -Infinity;
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
  return gainToDb(Math.sqrt(sum / data.length));
}

function setMeter(bar, label, db) {
  const minDb = -72;
  const maxDb = 0;
  const bounded = Number.isFinite(db) ? clamp(db, minDb, maxDb) : minDb;
  const percent = ((bounded - minDb) / (maxDb - minDb)) * 100;
  bar.style.width = `${percent}%`;
  label.textContent = Number.isFinite(db) ? `${Math.round(db)} dB` : "-∞ dB";
}

function drawAnalyzer() {
  const canvas = els.analyzerCanvas;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * ratio));
  const height = Math.max(1, Math.floor(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#0f1115";
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  if (!audio?.analyser) {
    drawIdleTrace(ctx, width, height);
    return;
  }

  const data = new Uint8Array(audio.analyser.frequencyBinCount);
  audio.analyser.getByteFrequencyData(data);
  const nyquist = audio.context.sampleRate / 2;
  const minFreq = 20;
  const maxFreq = Math.min(20000, nyquist);

  ctx.beginPath();
  for (let x = 0; x < width; x += 1) {
    const normalized = x / Math.max(1, width - 1);
    const freq = minFreq * Math.pow(maxFreq / minFreq, normalized);
    const index = clamp(Math.round((freq / nyquist) * data.length), 0, data.length - 1);
    const magnitude = data[index] / 255;
    const y = height - magnitude * height * 0.9 - height * 0.05;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "#45d3a2");
  gradient.addColorStop(0.55, "#38bdf8");
  gradient.addColorStop(1, "#f4b860");
  ctx.strokeStyle = gradient;
  ctx.lineWidth = Math.max(2, ratio * 2);
  ctx.stroke();
}

function drawGrid(ctx, width, height) {
  const frequencies = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  const minFreq = 20;
  const maxFreq = 20000;

  ctx.save();
  ctx.strokeStyle = "rgba(154, 166, 181, 0.18)";
  ctx.fillStyle = "rgba(154, 166, 181, 0.72)";
  ctx.lineWidth = 1;
  ctx.font = `${Math.max(11, Math.round(width / 88))}px ui-sans-serif, system-ui`;

  for (let i = 0; i <= 4; i += 1) {
    const y = (height / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  frequencies.forEach((freq) => {
    const x = (Math.log(freq / minFreq) / Math.log(maxFreq / minFreq)) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    if (freq === 20 || freq === 100 || freq === 1000 || freq === 10000) {
      ctx.fillText(formatFrequency(freq), x + 4, height - 10);
    }
  });
  ctx.restore();
}

function drawIdleTrace(ctx, width, height) {
  ctx.save();
  ctx.strokeStyle = "rgba(69, 211, 162, 0.42)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x < width; x += 8) {
    const y = height * 0.5 + Math.sin(x * 0.022) * height * 0.06;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function updateSweepProgress() {
  if (!state.running || state.mode !== "sweep" || !activeSweepStart) {
    els.sweepProgress.textContent = state.mode === "sweep" ? "Ready" : "Live";
    return;
  }

  const elapsed = (performance.now() - activeSweepStart) / 1000;
  const duration = clamp(state.sweepDuration, 1, 120);
  const progress = clamp(elapsed / duration, 0, 1);
  const start = clamp(state.sweepStart, 10, 22000);
  const end = clamp(state.sweepEnd, 10, 22000);
  const freq = state.logSweep
    ? start * Math.pow(end / start, progress)
    : start + (end - start) * progress;
  els.sweepProgress.textContent = `${formatFrequency(freq)}`;
}

function updateUi() {
  els.toggleAudio.classList.toggle("running", state.running);
  els.toggleLabel.textContent = state.running ? "Stop" : "Start";
  els.toggleAudio.querySelector(".icon").textContent = state.running ? "■" : "▶";
  setStatus(state.running ? "Audio running" : "Audio idle");

  els.modeButtons.forEach((button) => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", `${active}`);
  });
  els.channelButtons.forEach((button) => {
    const active = button.dataset.channel === state.channel;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", `${active}`);
  });

  els.volumeSlider.value = state.volumeDb;
  els.volumeReadout.textContent = `${state.volumeDb} dB`;
  els.toneFrequency.value = state.toneFrequency;
  els.toneReadout.textContent = formatFrequency(state.toneFrequency);
  els.sweepStart.value = state.sweepStart;
  els.sweepEnd.value = state.sweepEnd;
  els.sweepDuration.value = state.sweepDuration;
  els.logSweep.checked = state.logSweep;
  els.loopSweep.checked = state.loopSweep;
  els.sweepReadout.textContent = `${formatFrequency(state.sweepStart)} → ${formatFrequency(state.sweepEnd)}`;
  updateScopeMeta();
}

function updateScopeMeta() {
  const modeLabel = {
    white: "White noise",
    pink: "Pink noise",
    tone: "Sine tone",
    sweep: "Sine sweep",
  }[state.mode];
  const channelLabel = {
    both: "Both channels",
    left: "Left channel",
    right: "Right channel",
    alternate: "Alternating channels",
  }[state.channel];
  els.scopeTitle.textContent = modeLabel;
  els.scopeMeta.textContent = `${channelLabel} · ${state.volumeDb} dB`;
}

function setStatus(message) {
  els.statusText.textContent = message;
}

function persistState() {
  const saved = { ...state, running: false };
  localStorage.setItem("speaker-bench-settings", JSON.stringify(saved));
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem("speaker-bench-settings") || "{}");
    Object.assign(state, defaults, saved, { running: false });
  } catch {
    Object.assign(state, defaults);
  }
}

function bindEvents() {
  els.toggleAudio.addEventListener("click", () => {
    if (state.running) stopAudio();
    else startAudio();
  });
  els.panicButton.addEventListener("click", stopAudio);

  els.modeButtons.forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });
  els.channelButtons.forEach((button) => {
    button.addEventListener("click", () => setChannel(button.dataset.channel));
  });

  els.volumeSlider.addEventListener("input", () => {
    state.volumeDb = Number(els.volumeSlider.value);
    applyLevel();
    updateUi();
    persistState();
  });
  document.querySelectorAll("[data-level]").forEach((button) => {
    button.addEventListener("click", () => {
      state.volumeDb = Number(button.dataset.level);
      applyLevel();
      updateUi();
      persistState();
    });
  });

  els.toneFrequency.addEventListener("input", () => {
    state.toneFrequency = Number(els.toneFrequency.value);
    if (state.running && state.mode === "tone" && audio?.source?.frequency) {
      audio.source.frequency.setTargetAtTime(state.toneFrequency, audio.context.currentTime, 0.018);
    }
    updateUi();
    persistState();
  });
  document.querySelectorAll("[data-tone]").forEach((button) => {
    button.addEventListener("click", () => {
      state.toneFrequency = Number(button.dataset.tone);
      if (state.running && state.mode === "tone" && audio?.source?.frequency) {
        audio.source.frequency.setTargetAtTime(state.toneFrequency, audio.context.currentTime, 0.018);
      }
      updateUi();
      persistState();
    });
  });

  [els.sweepStart, els.sweepEnd, els.sweepDuration].forEach((input) => {
    input.addEventListener("change", () => {
      state.sweepStart = clamp(Number(els.sweepStart.value) || 20, 10, 22000);
      state.sweepEnd = clamp(Number(els.sweepEnd.value) || 20000, 10, 22000);
      state.sweepDuration = clamp(Number(els.sweepDuration.value) || 12, 1, 120);
      if (state.running && state.mode === "sweep") startAudio();
      updateUi();
      persistState();
    });
  });

  els.logSweep.addEventListener("change", () => {
    state.logSweep = els.logSweep.checked;
    if (state.running && state.mode === "sweep") startAudio();
    updateUi();
    persistState();
  });
  els.loopSweep.addEventListener("change", () => {
    state.loopSweep = els.loopSweep.checked;
    updateUi();
    persistState();
  });

  els.micButton.addEventListener("click", toggleMicMeter);
  els.identifyLeft.addEventListener("click", () => oneShotPing("left"));
  els.identifyRight.addEventListener("click", () => oneShotPing("right"));
  els.polarityPulse.addEventListener("click", polarityPulse);
  els.resetSettings.addEventListener("click", () => {
    const wasRunning = state.running;
    Object.assign(state, defaults, { running: wasRunning });
    if (wasRunning) startAudio();
    updateUi();
    persistState();
  });

  window.addEventListener("keydown", (event) => {
    if (event.code === "Space" && event.target === document.body) {
      event.preventDefault();
      if (state.running) stopAudio();
      else startAudio();
    }
    if (event.key === "Escape") stopAudio();
  });
}

loadState();
bindEvents();
updateUi();
startDrawing();
