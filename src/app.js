"use strict";

// Dev-only testing aid: ?speed=N makes all timers run N times faster so the
// 30-minute schedule can be clicked through in seconds. Never used in
// normal operation (default speed is 1x).
const DEV_SPEED = Math.max(1, Number(new URLSearchParams(location.search).get("speed")) || 1);

// Set to false (or delete the #developer-settings-section block in
// index.html) before deploying to GitHub Pages — it's a testing aid only.
const DEV_PANEL_ENABLED = true;

const TICK_MS = 250;

// Work-session length before a break is triggered, configurable from the
// settings panel (20-55 min) and persisted across reloads.
const SESSION_MINUTES_STORAGE_KEY = "deskbreak-session-minutes";
const DEFAULT_SESSION_MINUTES = 30;
const MIN_SESSION_MINUTES = 20;
const MAX_SESSION_MINUTES = 55;

function loadSessionMinutes() {
  const stored = Number(localStorage.getItem(SESSION_MINUTES_STORAGE_KEY));
  if (stored >= MIN_SESSION_MINUTES && stored <= MAX_SESSION_MINUTES) return stored;
  return DEFAULT_SESSION_MINUTES;
}

let sessionMinutes = loadSessionMinutes();

function getBreakIntervalMs() {
  return (sessionMinutes * 60 * 1000) / DEV_SPEED;
}

// Break lengths in minutes double as their duration-key ("3", "5") so
// adding another length (e.g. 10 or 15) later is just a new key here plus
// a matching entry in exercises.yaml's breaks map — no renaming needed.
// Which length is suggested alternates every break (section 4 of the
// requirements) — the user can always pick either one.
const BREAK_DURATIONS = {
  3: (3 * 60 * 1000) / DEV_SPEED,
  5: (5 * 60 * 1000) / DEV_SPEED,
};

const BREAK_LABELS = {
  3: "3-min break",
  5: "5-min break",
};

// Evidence-backed movements have direct randomized-trial support for
// interrupting sitting (requirements section 7). Additional movements are
// reasonable general strength/mobility choices but must not be presented as
// having the same level of evidence (section 8).
// Both the exercise pool and the named bundles offered per break length
// are loaded from exercises.yaml — edit that file, not this one, to
// change either. Top-level await pauses the rest of this module until
// it's parsed, so nothing below ever sees an empty list or undefined config.
const EXERCISE_CONFIG = await fetch("exercises.yaml")
  .then((response) => response.text())
  .then((yamlText) => jsyaml.load(yamlText));

const EXERCISES = EXERCISE_CONFIG.exercises;

// Named exercise bundles (from exercises.yaml) available per break
// length — see buildBreakChecklist for how they're shown/picked.
const BREAK_BUNDLE_CONFIG = EXERCISE_CONFIG.breaks;

// Session-only rotation state (resets on reload; daily persistence is a
// later feature). Tracks the last bundle key shown for each break length,
// so the suggested bundle is always the next one after it in that break
// length's list (wrapping back to the first past the end of the list).
const lastBundleKeyByDuration = {};

function nextBundleKey(durationKey, bundleKeys) {
  const lastKey = lastBundleKeyByDuration[durationKey];
  const lastIndex = lastKey ? bundleKeys.indexOf(lastKey) : -1;
  const nextKey = bundleKeys[(lastIndex + 1) % bundleKeys.length];
  lastBundleKeyByDuration[durationKey] = nextKey;
  return nextKey;
}

function durationKeyForBreakNumber(n) {
  return n % 2 === 1 ? "3" : "5";
}

function formatMMSS(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// e.g. "Monday, July 23 2026 at 4:32 PM"
const SHORT_MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sept", "Oct", "Nov", "Dec",
];

// e.g. "Wed, Sept 26 at 2:02PM (MT)" — collapses the Intl timezone
// abbreviation (MST/MDT, PST/PDT, etc.) down to the generic MT/PT/etc. form.
function formatFullTimestamp(ms) {
  const date = new Date(ms);
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
  const month = SHORT_MONTH_NAMES[date.getMonth()];
  const time = date
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(" ", "");
  const tzName = date
    .toLocaleTimeString("en-US", { timeZoneName: "short" })
    .split(" ")
    .pop();
  const tzAbbrev = tzName.replace(/^([A-Z])[SD]T$/, "$1T");
  return `${weekday}, ${month} ${date.getDate()} at ${time} (${tzAbbrev})`;
}

function progressPercent(remainingMs, totalMs) {
  return Math.min(100, Math.max(0, 100 - (remainingMs / totalMs) * 100));
}

const state = {
  status: "idle", // idle | running | paused | breakDue | onBreak | ended
  sessionStartedAt: null,
  sessionEndedAt: null,
  nextBreakAt: null,
  pausedRemainingMs: null,
  pauseStartedAt: null,
  pausedMsTotal: 0,
  breakNumber: 0,
  suggestedDurationKey: "3",
  breakDurationKey: null,
  breakStartedAt: null,
  breakEndsAt: null,
  breaksCompleted: 0,
  breaksSkipped: 0,
  movementMs: 0,
  breakEndSoundPlayed: false,
};

// A few gentle chime options, synthesized instead of loaded from audio
// files so there's nothing extra to fetch or vendor. The AudioContext is
// created lazily on the first user gesture (starting a session or opening
// settings), since browsers block audio that isn't triggered by user
// interaction.
const CHIME_STORAGE_KEY = "deskbreak-chime";
const CHIME_PROFILES = {
  chime: { label: "Chime", notes: [880, 1108.73] }, // A5, C#6 — soft major third
  bell: { label: "Bell", notes: [659.25] }, // E5, single long note
  marimba: { label: "Marimba", notes: [523.25, 659.25, 783.99] }, // C5-E5-G5 ascending
  ping: { label: "Soft Ping", notes: [1318.51] }, // E6, quick high note
};
const DEFAULT_CHIME_KEY = "chime";

function loadChimeKey() {
  const stored = localStorage.getItem(CHIME_STORAGE_KEY);
  return CHIME_PROFILES[stored] ? stored : DEFAULT_CHIME_KEY;
}

let chimeKey = loadChimeKey();
let audioCtx = null;

function primeAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  // iOS Safari specifically doesn't always treat creating/resuming a
  // context as enough to unlock audio — it wants an actual sound started
  // synchronously within the user gesture. A near-silent, near-instant
  // oscillator satisfies that without being audible.
  const unlockOsc = audioCtx.createOscillator();
  const unlockGain = audioCtx.createGain();
  unlockGain.gain.value = 0.0001;
  unlockOsc.connect(unlockGain).connect(audioCtx.destination);
  unlockOsc.start();
  unlockOsc.stop(audioCtx.currentTime + 0.01);
}

function playChime() {
  if (!audioCtx) return;
  // Mobile browsers commonly auto-suspend the AudioContext during the
  // long gap between priming it (session start) and a chime actually
  // needing to fire — e.g. after the screen locks or the tab backgrounds.
  // Without resuming here, notes get scheduled into a suspended context
  // and never make sound.
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  const startTime = audioCtx.currentTime;
  const notes = CHIME_PROFILES[chimeKey].notes;
  notes.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const noteStart = startTime + i * 0.12;
    gain.gain.setValueAtTime(0, noteStart);
    gain.gain.linearRampToValueAtTime(0.15, noteStart + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 1.1);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(noteStart);
    osc.stop(noteStart + 1.2);
  });
}

const el = {
  idleScreen: document.getElementById("idle-screen"),
  runningScreen: document.getElementById("running-screen"),
  endedScreen: document.getElementById("ended-screen"),
  countdown: document.getElementById("countdown"),
  countdownRing: document.getElementById("countdown-ring"),
  quickSuggestedTag3: document.getElementById("quick-suggested-tag-3"),
  quickSuggestedTag5: document.getElementById("quick-suggested-tag-5"),
  statElapsed: document.getElementById("stat-elapsed"),
  statCompleted: document.getElementById("stat-completed"),
  statSkipped: document.getElementById("stat-skipped"),
  statMovementMinutes: document.getElementById("stat-movement-minutes"),
  pauseBtn: document.getElementById("pause-btn"),
  resumeBtn: document.getElementById("resume-btn"),
  quickBreak3Btn: document.getElementById("quick-break-3-btn"),
  quickBreak5Btn: document.getElementById("quick-break-5-btn"),
  endSessionBtn: document.getElementById("end-session-btn"),
  startSessionBtn: document.getElementById("start-session-btn"),
  startDate: document.getElementById("start-date"),
  restartBtn: document.getElementById("restart-btn"),
  summaryStartTimestamp: document.getElementById("summary-start-timestamp"),
  summaryDuration: document.getElementById("summary-duration"),
  summaryCompleted: document.getElementById("summary-completed"),
  summarySkipped: document.getElementById("summary-skipped"),
  summaryMovementMinutes: document.getElementById("summary-movement-minutes"),
  breakDueDialog: document.getElementById("break-due-dialog"),
  breakActiveDialog: document.getElementById("break-active-dialog"),
  breakActiveTitle: document.getElementById("break-active-title"),
  startBreak3Btn: document.getElementById("start-break-3-btn"),
  startBreak5Btn: document.getElementById("start-break-5-btn"),
  suggestedTag3: document.getElementById("suggested-tag-3"),
  suggestedTag5: document.getElementById("suggested-tag-5"),
  skipBreakBtn: document.getElementById("skip-break-btn"),
  breakCountdown: document.getElementById("break-countdown"),
  breakCountdownRing: document.getElementById("break-countdown-ring"),
  breakChecklist: document.getElementById("break-checklist"),
  endBreakBtn: document.getElementById("end-break-btn"),
  cancelBreakBtn: document.getElementById("cancel-break-btn"),
  settingsToggleBtn: document.getElementById("settings-toggle-btn"),
  settingsPanel: document.getElementById("settings-panel"),
  settingsCloseBtn: document.getElementById("settings-close-btn"),
  darkModeToggle: document.getElementById("dark-mode-toggle"),
  sessionLengthRange: document.getElementById("session-length-range"),
  sessionLengthValue: document.getElementById("session-length-value"),
  chimeOptions: document.getElementById("chime-options"),
  developerSettingsSection: document.getElementById("developer-settings-section"),
  devSpeedToggle: document.getElementById("dev-speed-toggle"),
};

if (!DEV_PANEL_ENABLED) {
  el.developerSettingsSection.remove();
}

const TEST_SPEED = 200;

el.devSpeedToggle.checked = DEV_SPEED > 1;

el.devSpeedToggle.addEventListener("change", (event) => {
  const url = new URL(location.href);
  if (event.target.checked) {
    url.searchParams.set("speed", String(TEST_SPEED));
  } else {
    url.searchParams.delete("speed");
  }
  location.href = url.toString();
});

// Native <dialog>: showModal()/close() control visibility (setting the
// `open` attribute directly would show it without a backdrop or modal
// behavior). Escape fires a real, standardized "cancel" event — no more
// guessing a component's custom event names. We let the browser's default
// close action proceed and just sync our own state to match. A click that
// lands on the <dialog> element itself (not the <article> surface inside
// it) is a backdrop click, which native dialogs don't close on by default,
// so it's wired up explicitly for the same cancel behavior.
function setDialogOpen(dialog, shouldBeOpen) {
  if (shouldBeOpen && !dialog.open) {
    dialog.showModal();
  } else if (!shouldBeOpen && dialog.open) {
    dialog.close();
  }
}

[el.breakDueDialog, el.breakActiveDialog].forEach((dialog) => {
  dialog.addEventListener("cancel", () => {
    cancelBreak();
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      cancelBreak();
    }
  });
});

function checkboxItemHtml(id, name, reps) {
  const repsHtml = reps ? `<span class="exercise-reps">${reps}</span>` : "";
  return `<label class="exercise-item"><input type="checkbox" data-item-id="${id}" /><span class="exercise-item-text"><span class="exercise-item-name">${name}</span>${repsHtml}</span></label>`;
}

// Each card is a uniform vertical list of checkable items — a walk item and
// any movements that go with it are all just items in the same list, none
// of them treated specially. The "Suggested" label belongs to the card as a
// whole (it's the bundle that's suggested, not any one exercise in it), so
// the card itself gets a highlight color and the word appears once in its
// top-right corner. At most one card on the whole screen ever carries it.
function cardHtml(items, tag) {
  const cardClass = tag ? "exercise-card exercise-card-suggested" : "exercise-card";
  const itemsHtml = items.map((item) => checkboxItemHtml(item.id, item.name, item.reps)).join("");
  const cardDiv = `<div class="${cardClass}">${itemsHtml}</div>`;
  if (!tag) return cardDiv;
  return `<div class="exercise-card-wrap"><span class="exercise-card-label">${tag}</span>${cardDiv}</div>`;
}

function findExercise(id) {
  return EXERCISES.find((ex) => ex.id === id);
}

// Every bundle defined for this break length is shown (scroll right for
// more); one is picked to be marked Suggested, preferring bundles not
// shown recently. Walk is just an exercise id like any other — whichever
// bundles list it are the ones that include a walk.
function buildBreakChecklist(durationKey) {
  const config = BREAK_BUNDLE_CONFIG[durationKey];
  const bundleKeys = Object.keys(config.bundles);
  const suggestedKey = nextBundleKey(durationKey, bundleKeys);
  // Suggested card always renders first/leftmost.
  const orderedKeys = [suggestedKey, ...bundleKeys.filter((key) => key !== suggestedKey)];

  const bundleCardsHtml = orderedKeys
    .map((key) =>
      cardHtml(
        config.bundles[key].map((id) => {
          const ex = findExercise(id);
          // DOM id combines the bundle key with the exercise's catalog id
          // so checkboxes track independently even if the same exercise
          // (e.g. a walk) appears in more than one bundle.
          return { id: `${key}-${ex.id}`, name: ex.name, reps: ex.target };
        }),
        key === suggestedKey ? "Suggested" : null
      )
    )
    .join("");

  const otherCardHtml = `<div class="exercise-card exercise-card-other">
    ${checkboxItemHtml("other", "Other")}
    <input type="text" id="other-detail-input" placeholder="Custom Exercise" />
  </div>`;

  el.breakChecklist.innerHTML = `${bundleCardsHtml}${otherCardHtml}`;
}


function startSession() {
  primeAudio();
  const now = Date.now();
  state.status = "running";
  state.sessionStartedAt = now;
  state.sessionEndedAt = null;
  state.nextBreakAt = now + getBreakIntervalMs();
  state.pausedMsTotal = 0;
  state.pauseStartedAt = null;
  state.breakNumber = 0;
  state.breaksCompleted = 0;
  state.breaksSkipped = 0;
  state.movementMs = 0;
  Object.keys(lastBundleKeyByDuration).forEach((key) => delete lastBundleKeyByDuration[key]);
  render();
}

function pauseSession() {
  if (state.status !== "running") return;
  state.pausedRemainingMs = state.nextBreakAt - Date.now();
  state.pauseStartedAt = Date.now();
  state.status = "paused";
  render();
}

function resumeSession() {
  if (state.status !== "paused") return;
  state.pausedMsTotal += Date.now() - state.pauseStartedAt;
  state.pauseStartedAt = null;
  state.nextBreakAt = Date.now() + state.pausedRemainingMs;
  state.status = "running";
  render();
}

function enterBreakDue() {
  state.suggestedDurationKey = durationKeyForBreakNumber(state.breakNumber + 1);
  state.status = "breakDue";
  playChime();
  render();
}

function quickStartBreak(durationKey) {
  if (state.status !== "running") return;
  startBreak(durationKey);
}

function startBreak(durationKey) {
  const now = Date.now();
  state.breakDurationKey = durationKey;
  state.breakStartedAt = now;
  state.breakEndsAt = now + BREAK_DURATIONS[durationKey];
  state.breakEndSoundPlayed = false;
  state.status = "onBreak";
  buildBreakChecklist(durationKey);
  render();
}

function skipBreak() {
  state.breaksSkipped += 1;
  state.breakNumber += 1;
  state.nextBreakAt = Date.now() + getBreakIntervalMs();
  state.status = "running";
  render();
}

// Cancelling a break (via the dialog's X button or the Cancel button) does
// not count as completed or skipped — it undoes opening the break screen.
// If the break was started manually while the schedule was still pending
// (nextBreakAt in the future), that schedule is left untouched, so it's as
// if the break was never opened. If it came from the automatic due prompt
// (nextBreakAt already in the past), the schedule is pushed one interval
// ahead so dismissing it doesn't immediately re-trigger the same prompt.
function cancelBreak() {
  if (state.nextBreakAt === null || state.nextBreakAt <= Date.now()) {
    state.nextBreakAt = Date.now() + getBreakIntervalMs();
  }
  state.status = "running";
  render();
}

function endBreak() {
  state.breaksCompleted += 1;
  // DEV_SPEED compresses wall-clock time, so credit the logical (uncompressed)
  // duration — otherwise a break "completed" in a couple of real seconds at
  // high test speed would round down to 0 movement minutes.
  state.movementMs += (Date.now() - state.breakStartedAt) * DEV_SPEED;

  state.breakNumber += 1;
  state.nextBreakAt = Date.now() + getBreakIntervalMs();
  state.status = "running";
  render();
}

function endSession() {
  state.sessionEndedAt = Date.now();
  state.status = "ended";
  render();
}


function currentElapsedSessionMs(now) {
  if (!state.sessionStartedAt) return 0;
  const openPauseMs =
    state.status === "paused" && state.pauseStartedAt
      ? now - state.pauseStartedAt
      : 0;
  return now - state.sessionStartedAt - state.pausedMsTotal - openPauseMs;
}

function tick() {
  const now = Date.now();

  if (state.status === "running" && state.nextBreakAt !== null) {
    const remaining = state.nextBreakAt - now;
    if (remaining <= 0) {
      enterBreakDue();
      return;
    }
  }

  if (
    state.status === "onBreak" &&
    state.breakEndsAt !== null &&
    now >= state.breakEndsAt &&
    !state.breakEndSoundPlayed
  ) {
    state.breakEndSoundPlayed = true;
    playChime();
  }

  render();
}

function render() {
  el.idleScreen.classList.toggle("hidden", state.status !== "idle");
  el.runningScreen.classList.toggle(
    "hidden",
    !["running", "paused", "breakDue", "onBreak"].includes(state.status)
  );
  el.endedScreen.classList.toggle("hidden", state.status !== "ended");

  const now = Date.now();
  const nextSuggestedKey = durationKeyForBreakNumber(state.breakNumber + 1);
  el.quickSuggestedTag3.classList.toggle("visible", nextSuggestedKey === "3");
  el.quickSuggestedTag5.classList.toggle("visible", nextSuggestedKey === "5");
  el.quickBreak3Btn.classList.toggle("suggested", nextSuggestedKey === "3");
  el.quickBreak5Btn.classList.toggle("suggested", nextSuggestedKey === "5");

  if (state.status === "running" && state.nextBreakAt !== null) {
    const remainingMs = state.nextBreakAt - now;
    el.countdown.textContent = formatMMSS(remainingMs * DEV_SPEED);
    el.countdownRing.style.setProperty("--percent", progressPercent(remainingMs, getBreakIntervalMs()));
  } else if (state.status === "paused" && state.pausedRemainingMs !== null) {
    el.countdown.textContent = formatMMSS(state.pausedRemainingMs * DEV_SPEED);
    el.countdownRing.style.setProperty("--percent", progressPercent(state.pausedRemainingMs, getBreakIntervalMs()));
  }

  el.statElapsed.textContent = formatMMSS(currentElapsedSessionMs(now));
  el.statCompleted.textContent = String(state.breaksCompleted);
  el.statSkipped.textContent = String(state.breaksSkipped);
  el.statMovementMinutes.textContent = String(
    Math.round(state.movementMs / 60000)
  );

  el.pauseBtn.classList.toggle("hidden", state.status !== "running");
  el.resumeBtn.classList.toggle("hidden", state.status !== "paused");
  el.quickBreak3Btn.classList.toggle("hidden", state.status !== "running");
  el.quickBreak5Btn.classList.toggle("hidden", state.status !== "running");

  setDialogOpen(el.breakDueDialog, state.status === "breakDue");
  setDialogOpen(el.breakActiveDialog, state.status === "onBreak");

  if (state.status === "breakDue") {
    const suggested = state.suggestedDurationKey;

    el.suggestedTag3.classList.toggle("visible", suggested === "3");
    el.suggestedTag5.classList.toggle("visible", suggested === "5");
    el.startBreak3Btn.classList.toggle("suggested", suggested === "3");
    el.startBreak5Btn.classList.toggle("suggested", suggested === "5");
  }

  if (state.status === "onBreak") {
    el.breakActiveTitle.textContent = BREAK_LABELS[state.breakDurationKey];
    const breakRemainingMs = state.breakEndsAt - now;
    const breakTotalMs = state.breakEndsAt - state.breakStartedAt;
    el.breakCountdown.textContent = formatMMSS(breakRemainingMs * DEV_SPEED);
    el.breakCountdownRing.style.setProperty("--percent", progressPercent(breakRemainingMs, breakTotalMs));
  }

  if (state.status === "ended") {
    el.summaryStartTimestamp.textContent = formatFullTimestamp(state.sessionStartedAt);
    el.summaryDuration.textContent = formatMMSS(
      state.sessionEndedAt - state.sessionStartedAt - state.pausedMsTotal
    );
    el.summaryCompleted.textContent = String(state.breaksCompleted);
    el.summarySkipped.textContent = String(state.breaksSkipped);
    el.summaryMovementMinutes.textContent = String(
      Math.round(state.movementMs / 60000)
    );
  }
}

el.startSessionBtn.addEventListener("click", startSession);
el.pauseBtn.addEventListener("click", pauseSession);
el.resumeBtn.addEventListener("click", resumeSession);
el.quickBreak3Btn.addEventListener("click", () => quickStartBreak("3"));
el.quickBreak5Btn.addEventListener("click", () => quickStartBreak("5"));
el.endSessionBtn.addEventListener("click", endSession);
el.restartBtn.addEventListener("click", startSession);
el.startBreak3Btn.addEventListener("click", () => startBreak("3"));
el.startBreak5Btn.addEventListener("click", () => startBreak("5"));
el.skipBreakBtn.addEventListener("click", skipBreak);
el.endBreakBtn.addEventListener("click", endBreak);
el.cancelBreakBtn.addEventListener("click", cancelBreak);

// The initial theme was already applied by the inline script in <head>
// (before first paint); this just keeps the settings switch in sync and
// lets the user override it, remembering their explicit choice from then on.
const THEME_STORAGE_KEY = "deskbreak-theme";

el.darkModeToggle.checked = document.documentElement.getAttribute("data-theme") === "dark";

el.darkModeToggle.addEventListener("change", (event) => {
  const next = event.target.checked ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(THEME_STORAGE_KEY, next);
});

// Settings panel: work-session length and timer sound. Both persist across
// reloads; changing the session length only affects breaks scheduled from
// this point on (an in-progress countdown isn't retroactively rescaled).
el.settingsToggleBtn.addEventListener("click", () => {
  primeAudio();
  const isOpening = el.settingsPanel.classList.contains("hidden");
  el.settingsPanel.classList.toggle("hidden");
  // Explicitly hides the button while the panel is open, rather than
  // relying on z-index/stacking alone — guarantees it's actually gone
  // from the user's perspective instead of just "behind" in paint order.
  // Mobile only (see .icon-btn.panel-open in style.css) — on desktop the
  // panel is a small popover, not a full-screen sheet, so the button
  // stays visible.
  el.settingsToggleBtn.classList.toggle("panel-open", isOpening);
});

el.settingsCloseBtn.addEventListener("click", () => {
  el.settingsPanel.classList.add("hidden");
  el.settingsToggleBtn.classList.remove("panel-open");
});

el.sessionLengthRange.value = String(sessionMinutes);
el.sessionLengthValue.textContent = `${sessionMinutes} min`;

el.sessionLengthRange.addEventListener("input", (event) => {
  sessionMinutes = Number(event.target.value);
  el.sessionLengthValue.textContent = `${sessionMinutes} min`;
  localStorage.setItem(SESSION_MINUTES_STORAGE_KEY, String(sessionMinutes));
});

function renderChimeOptions() {
  el.chimeOptions.innerHTML = Object.entries(CHIME_PROFILES)
    .map(([key, profile]) => `
      <button type="button" class="chime-option${key === chimeKey ? " active" : ""}" data-chime-key="${key}">
        ${profile.label}
        <i class="ph ph-check chime-option-check${key === chimeKey ? "" : " hidden"}" aria-hidden="true"></i>
      </button>
    `)
    .join("");
}

el.chimeOptions.addEventListener("click", (event) => {
  const button = event.target.closest(".chime-option");
  if (!button) return;
  chimeKey = button.dataset.chimeKey;
  localStorage.setItem(CHIME_STORAGE_KEY, chimeKey);
  renderChimeOptions();
  primeAudio();
  playChime();
});

renderChimeOptions();

el.startDate.textContent = new Date().toLocaleDateString("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") tick();
});
window.addEventListener("focus", tick);
window.addEventListener("pageshow", tick);

setInterval(tick, TICK_MS);
render();
