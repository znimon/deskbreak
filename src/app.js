"use strict";

// Dev-only testing aid: ?speed=N makes all timers run N times faster so the
// 30-minute schedule can be clicked through in seconds. Never used in
// normal operation (default speed is 1x).
const DEV_SPEED = Math.max(1, Number(new URLSearchParams(location.search).get("speed")) || 1);

// Set to false (or delete the #dev-panel block in index.html) before
// deploying to GitHub Pages — the panel is a testing aid only.
const DEV_PANEL_ENABLED = true;

const BREAK_INTERVAL_MS = (30 * 60 * 1000) / DEV_SPEED;
const TICK_MS = 250;

// Breaks are defined by their length, not a named type: a 3-minute break
// is walk-only, a 5-minute break is walk plus optional resistance/mobility
// movements. Which length is suggested still alternates every 30 minutes
// (section 4 of the requirements) — the user can always pick either one.
const BREAK_DURATIONS = {
  short: (3 * 60 * 1000) / DEV_SPEED,
  long: (5 * 60 * 1000) / DEV_SPEED,
};

const BREAK_LABELS = {
  short: "3-min break",
  long: "5-min break",
};

// Controls how many exercise bundles are offered and how big each one is.
// Both durations use the same card-based bundle interface — a 3-minute
// break just gets fewer, lighter bundles than a 5-minute break. Raising
// bundleCount (up to the number of distinct EXERCISES available) is enough
// to offer more bundles later; no other code needs to change.
const BREAK_BUNDLE_CONFIG = {
  short: {
    totalMinutesLabel: "3 minutes",
    bundleWalkLabel: "Walk 2 minutes",
    bundleCount: 1,
    exercisesPerBundle: 1,
  },
  long: {
    totalMinutesLabel: "5 minutes",
    bundleWalkLabel: "Walk 2–3 minutes",
    bundleCount: 2,
    exercisesPerBundle: 2,
  },
};


// Evidence-backed movements have direct randomized-trial support for
// interrupting sitting (requirements section 7). Additional movements are
// reasonable general strength/mobility choices but must not be presented as
// having the same level of evidence (section 8). Used on 5-minute breaks.
const EXERCISES = [
  { id: "squats", name: "Squats", target: "8–12 reps", category: "evidence", region: "lower", type: "strength" },
  { id: "calf-raises", name: "Calf raises", target: "10–15 reps", category: "evidence", region: "lower", type: "strength" },
  { id: "knee-raises", name: "Standing knee raises", target: "10–20 alternating reps", category: "evidence", region: "lower", type: "strength" },
  { id: "glute-contractions", name: "Glute contractions", target: "10–15 reps or short holds", category: "evidence", region: "lower", type: "strength" },
  { id: "pushups", name: "Push-ups", target: "5–10 reps", category: "additional", region: "upper", type: "strength" },
  { id: "walkout-planks", name: "Walkout planks", target: "3–5 reps", category: "additional", region: "core", type: "strength" },
  { id: "thoracic-rotations", name: "Thoracic rotations", target: "5 per side", category: "additional", region: "upper", type: "mobility" },
  { id: "hip-flexor-stretch", name: "Hip-flexor stretch", target: "20–30 sec per side", category: "additional", region: "lower", type: "mobility" },
  { id: "wall-slides", name: "Wall slides", target: "8–12 reps", category: "additional", region: "upper", type: "mobility" },
];

// Session-only rotation state (resets on reload; daily persistence is a
// later feature). Tracks how often each exercise has been performed today
// and which exercises were done on the previous 5-minute break, so
// suggestions follow requirements section 9: prefer movements not yet done
// today, prefer least-frequent movements, alternate upper/lower body and
// strength/mobility, and avoid repeating the previous break's picks.
const exerciseStats = {};
let previousExerciseSelection = [];

function suggestExercises(count, poolOverride) {
  const candidatePool = poolOverride || EXERCISES;
  const previousSet = new Set(previousExerciseSelection);
  const candidates = candidatePool.map((ex) => ({
    ex,
    timesToday: exerciseStats[ex.id] ? exerciseStats[ex.id].timesPerformedToday : 0,
    repeated: previousSet.has(ex.id),
  }));

  function pickBest(pool, against) {
    const sorted = pool.slice().sort((a, b) => {
      if (a.timesToday !== b.timesToday) return a.timesToday - b.timesToday;
      if (a.repeated !== b.repeated) return a.repeated ? 1 : -1;
      if (against) {
        const altA = (a.ex.region !== against.region ? 1 : 0) + (a.ex.type !== against.type ? 1 : 0);
        const altB = (b.ex.region !== against.region ? 1 : 0) + (b.ex.type !== against.type ? 1 : 0);
        if (altA !== altB) return altB - altA;
      }
      return Math.random() - 0.5;
    });
    return sorted[0];
  }

  const picks = [];
  let pool = candidates;

  const first = pickBest(pool, null);
  picks.push(first.ex);
  pool = pool.filter((c) => c.ex.id !== first.ex.id);

  while (picks.length < count && pool.length > 0) {
    const next = pickBest(pool, picks[picks.length - 1]);
    picks.push(next.ex);
    pool = pool.filter((c) => c.ex.id !== next.ex.id);
  }

  return picks;
}

function durationKeyForBreakNumber(n) {
  return n % 2 === 1 ? "short" : "long";
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
  suggestedDurationKey: "short",
  breakDurationKey: null,
  breakStartedAt: null,
  breakEndsAt: null,
  breaksCompleted: 0,
  breaksSkipped: 0,
  movementMs: 0,
  currentChecklistSelections: new Set(),
  breakEndSoundPlayed: false,
};

// Gentle two-note chime, synthesized instead of loaded from an audio file
// so there's nothing extra to fetch or vendor. The AudioContext is created
// lazily on the first user gesture (starting a session), since browsers
// block audio that isn't triggered by user interaction.
let audioCtx = null;

function primeAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function playChime() {
  if (!audioCtx) return;
  const startTime = audioCtx.currentTime;
  const notes = [880, 1108.73]; // A5, C#6 — a soft major-third chime
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
  themeToggleBtn: document.getElementById("theme-toggle-btn"),
  devPanel: document.getElementById("dev-panel"),
  devSpeedToggle: document.getElementById("dev-speed-toggle"),
};

if (!DEV_PANEL_ENABLED) {
  el.devPanel.remove();
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

function checkboxItemHtml(id, label) {
  return `<label><input type="checkbox" data-item-id="${id}" /><span class="exercise-item-text">${label}</span></label>`;
}

// Each card is a uniform vertical list of checkable items — a walk item and
// any movements that go with it are all just items in the same list, none
// of them treated specially. The "Suggested" label belongs to the card as a
// whole (it's the bundle that's suggested, not any one exercise in it), so
// the card itself gets a highlight color and the word appears once in its
// top-right corner. At most one card on the whole screen ever carries it.
function cardHtml(items, tag) {
  const cardClass = tag ? "packet-card packet-card-suggested" : "packet-card";
  const labelHtml = tag ? `<span class="packet-card-label">${tag}</span>` : "";
  const itemsHtml = items.map((item) => checkboxItemHtml(item.id, item.label)).join("");
  return `<div class="${cardClass}">${labelHtml}${itemsHtml}</div>`;
}

function buildExerciseBundles(count, exercisesPerBundle) {
  const bundles = [];
  const excludeIds = new Set();

  for (let i = 0; i < count; i++) {
    const pool = EXERCISES.filter((ex) => !excludeIds.has(ex.id));
    const bundle = suggestExercises(exercisesPerBundle, pool);
    if (bundle.length === 0) break;
    bundles.push(bundle);
    bundle.forEach((ex) => excludeIds.add(ex.id));
  }

  return bundles;
}

function buildBreakChecklist(durationKey) {
  const config = BREAK_BUNDLE_CONFIG[durationKey];
  const bundles = buildExerciseBundles(config.bundleCount, config.exercisesPerBundle);

  // Only the long break's first bundle is ever tagged Suggested; the short
  // break's single tag lives on plain walking instead. Never both at once.
  const bundleCardsHtml = bundles
    .map((bundle, i) =>
      cardHtml(
        [
          { id: `walk-bundle-${i}`, label: config.bundleWalkLabel },
          ...bundle.map((ex) => ({
            id: ex.id,
            label: `${ex.name}<span class="exercise-reps">${ex.target}</span>`,
          })),
        ],
        durationKey === "long" && i === 0 ? "Suggested" : null
      )
    )
    .join("");

  const walkOnlyCardHtml = cardHtml(
    [{ id: "walking-only", label: `Walk ${config.totalMinutesLabel}` }],
    durationKey === "short" ? "Suggested" : null
  );

  const otherCardHtml = `<div class="packet-card packet-card-other">
    <label><input type="checkbox" data-item-id="other" /> Other</label>
    <input type="text" id="other-detail-input" placeholder="Custom Exercise (Optional)" />
  </div>`;

  const cardsHtml =
    durationKey === "short"
      ? walkOnlyCardHtml + bundleCardsHtml
      : bundleCardsHtml + walkOnlyCardHtml;

  el.breakChecklist.innerHTML = `${cardsHtml}${otherCardHtml}`;
}

el.breakChecklist.addEventListener("change", (event) => {
  const id = event.target.dataset.itemId;
  if (!id) return;

  if (event.target.checked) {
    state.currentChecklistSelections.add(id);
  } else {
    state.currentChecklistSelections.delete(id);
  }
});

function startSession() {
  primeAudio();
  const now = Date.now();
  state.status = "running";
  state.sessionStartedAt = now;
  state.sessionEndedAt = null;
  state.nextBreakAt = now + BREAK_INTERVAL_MS;
  state.pausedMsTotal = 0;
  state.pauseStartedAt = null;
  state.breakNumber = 0;
  state.breaksCompleted = 0;
  state.breaksSkipped = 0;
  state.movementMs = 0;
  Object.keys(exerciseStats).forEach((id) => delete exerciseStats[id]);
  previousExerciseSelection = [];
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
  state.currentChecklistSelections = new Set();
  buildBreakChecklist(durationKey);
  render();
}

function skipBreak() {
  state.breaksSkipped += 1;
  state.breakNumber += 1;
  state.nextBreakAt = Date.now() + BREAK_INTERVAL_MS;
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
    state.nextBreakAt = Date.now() + BREAK_INTERVAL_MS;
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

  const selectedIds = Array.from(state.currentChecklistSelections).filter((id) =>
    EXERCISES.some((ex) => ex.id === id)
  );
  if (selectedIds.length > 0) {
    selectedIds.forEach((id) => {
      if (!exerciseStats[id]) exerciseStats[id] = { timesPerformedToday: 0 };
      exerciseStats[id].timesPerformedToday += 1;
    });
    previousExerciseSelection = selectedIds;
  }

  state.breakNumber += 1;
  state.nextBreakAt = Date.now() + BREAK_INTERVAL_MS;
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
  el.quickSuggestedTag3.classList.toggle("hidden", nextSuggestedKey !== "short");
  el.quickSuggestedTag5.classList.toggle("hidden", nextSuggestedKey !== "long");
  el.quickBreak3Btn.classList.toggle("suggested", nextSuggestedKey === "short");
  el.quickBreak5Btn.classList.toggle("suggested", nextSuggestedKey === "long");

  if (state.status === "running" && state.nextBreakAt !== null) {
    const remainingMs = state.nextBreakAt - now;
    el.countdown.textContent = formatMMSS(remainingMs * DEV_SPEED);
    el.countdownRing.style.setProperty("--percent", progressPercent(remainingMs, BREAK_INTERVAL_MS));
  } else if (state.status === "paused" && state.pausedRemainingMs !== null) {
    el.countdown.textContent = formatMMSS(state.pausedRemainingMs * DEV_SPEED);
    el.countdownRing.style.setProperty("--percent", progressPercent(state.pausedRemainingMs, BREAK_INTERVAL_MS));
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

    el.suggestedTag3.classList.toggle("hidden", suggested !== "short");
    el.suggestedTag5.classList.toggle("hidden", suggested !== "long");
    el.startBreak3Btn.classList.toggle("suggested", suggested === "short");
    el.startBreak5Btn.classList.toggle("suggested", suggested === "long");
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
el.quickBreak3Btn.addEventListener("click", () => quickStartBreak("short"));
el.quickBreak5Btn.addEventListener("click", () => quickStartBreak("long"));
el.endSessionBtn.addEventListener("click", endSession);
el.restartBtn.addEventListener("click", startSession);
el.startBreak3Btn.addEventListener("click", () => startBreak("short"));
el.startBreak5Btn.addEventListener("click", () => startBreak("long"));
el.skipBreakBtn.addEventListener("click", skipBreak);
el.endBreakBtn.addEventListener("click", endBreak);
el.cancelBreakBtn.addEventListener("click", cancelBreak);

// The initial theme was already applied by the inline script in <head>
// (before first paint); this just keeps the toggle icon in sync and lets
// the user override it, remembering their explicit choice from then on.
const THEME_STORAGE_KEY = "deskbreak-theme";

function applyThemeIcon() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  el.themeToggleBtn.querySelector("i").className = isDark ? "ph ph-sun" : "ph ph-moon";
}

el.themeToggleBtn.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(THEME_STORAGE_KEY, next);
  applyThemeIcon();
});

applyThemeIcon();

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
