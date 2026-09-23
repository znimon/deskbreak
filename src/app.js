"use strict";

// Dev-only testing aid: ?speed=60 makes all timers run 60x faster so the
// 30-minute schedule can be clicked through in seconds. Never used in
// normal operation (default speed is 1x).
const DEV_SPEED = Math.max(1, Number(new URLSearchParams(location.search).get("speed")) || 1);

const BREAK_INTERVAL_MS = (30 * 60 * 1000) / DEV_SPEED;
const BREAK_TARGET_MS = (5 * 60 * 1000) / DEV_SPEED;
const OVERDUE_NOTICE_THRESHOLD_MS = (60 * 1000) / DEV_SPEED;
const TICK_MS = 250;

const BREAK_COPY = {
  A: {
    title: "BREAK A",
    dueInstructions: "Walk for 3–5 minutes.",
    duePreferred: "Preferred target: 5 minutes",
    activeInstructions: "Walk for 3–5 minutes.",
    nextDetail: "5 minute walk",
  },
  B: {
    title: "BREAK B",
    dueInstructions:
      "Walk for 2–3 minutes, then optionally choose 1–2 movements.",
    duePreferred: "You can also continue walking for the full break.",
    activeInstructions:
      "Walk for 2–3 minutes, then optionally add movements, or keep walking.",
    nextDetail: "2–3 minute walk + optional movements",
  },
};

function breakTypeForNumber(n) {
  return n % 2 === 1 ? "A" : "B";
}

function formatMMSS(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const state = {
  status: "idle", // idle | running | paused | breakDue | onBreak | ended
  workdayStartedAt: null,
  workdayEndedAt: null,
  nextBreakAt: null,
  pausedRemainingMs: null,
  pauseStartedAt: null,
  pausedMsTotal: 0,
  breakNumber: 0,
  breakScheduledAt: null,
  breakStartedAt: null,
  breakEndsAt: null,
  breaksCompleted: 0,
  breaksSkipped: 0,
  movementMs: 0,
};

const el = {
  idleScreen: document.getElementById("idle-screen"),
  runningScreen: document.getElementById("running-screen"),
  endedScreen: document.getElementById("ended-screen"),
  countdown: document.getElementById("countdown"),
  nextBreakType: document.getElementById("next-break-type"),
  nextBreakDetail: document.getElementById("next-break-detail"),
  statElapsed: document.getElementById("stat-elapsed"),
  statCompleted: document.getElementById("stat-completed"),
  statSkipped: document.getElementById("stat-skipped"),
  statMovementMinutes: document.getElementById("stat-movement-minutes"),
  pauseBtn: document.getElementById("pause-btn"),
  resumeBtn: document.getElementById("resume-btn"),
  takeBreakBtn: document.getElementById("take-break-btn"),
  endWorkdayBtn: document.getElementById("end-workday-btn"),
  startWorkdayBtn: document.getElementById("start-workday-btn"),
  restartBtn: document.getElementById("restart-btn"),
  summaryDuration: document.getElementById("summary-duration"),
  summaryCompleted: document.getElementById("summary-completed"),
  summarySkipped: document.getElementById("summary-skipped"),
  summaryMovementMinutes: document.getElementById("summary-movement-minutes"),
  breakOverlay: document.getElementById("break-overlay"),
  breakDueView: document.getElementById("break-due-view"),
  breakActiveView: document.getElementById("break-active-view"),
  breakTitle: document.getElementById("break-title"),
  breakOverdueNote: document.getElementById("break-overdue-note"),
  breakInstructions: document.getElementById("break-instructions"),
  breakPreferred: document.getElementById("break-preferred"),
  startBreakBtn: document.getElementById("start-break-btn"),
  skipBreakBtn: document.getElementById("skip-break-btn"),
  breakActiveTitle: document.getElementById("break-active-title"),
  breakCountdown: document.getElementById("break-countdown"),
  breakActiveInstructions: document.getElementById("break-active-instructions"),
  endBreakBtn: document.getElementById("end-break-btn"),
  devSpeedBadge: document.getElementById("dev-speed-badge"),
  devSpeedToggleBtn: document.getElementById("dev-speed-toggle-btn"),
};

const TEST_SPEED = 60;

if (DEV_SPEED > 1) {
  el.devSpeedBadge.textContent = `TEST MODE: ${DEV_SPEED}x SPEED`;
  el.devSpeedBadge.classList.remove("hidden");
  el.devSpeedToggleBtn.textContent = "Disable test speed";
} else {
  el.devSpeedToggleBtn.textContent = `Enable test speed (${TEST_SPEED}x, for testing only)`;
}

el.devSpeedToggleBtn.addEventListener("click", () => {
  const url = new URL(location.href);
  if (DEV_SPEED > 1) {
    url.searchParams.delete("speed");
  } else {
    url.searchParams.set("speed", String(TEST_SPEED));
  }
  location.href = url.toString();
});

function startWorkday() {
  const now = Date.now();
  state.status = "running";
  state.workdayStartedAt = now;
  state.workdayEndedAt = null;
  state.nextBreakAt = now + BREAK_INTERVAL_MS;
  state.pausedMsTotal = 0;
  state.pauseStartedAt = null;
  state.breakNumber = 0;
  state.breaksCompleted = 0;
  state.breaksSkipped = 0;
  state.movementMs = 0;
  render();
}

function pauseWorkday() {
  if (state.status !== "running") return;
  state.pausedRemainingMs = state.nextBreakAt - Date.now();
  state.pauseStartedAt = Date.now();
  state.status = "paused";
  render();
}

function resumeWorkday() {
  if (state.status !== "paused") return;
  state.pausedMsTotal += Date.now() - state.pauseStartedAt;
  state.pauseStartedAt = null;
  state.nextBreakAt = Date.now() + state.pausedRemainingMs;
  state.status = "running";
  render();
}

function enterBreakDue(scheduledAt) {
  state.currentBreakType = breakTypeForNumber(state.breakNumber + 1);
  state.breakScheduledAt = scheduledAt;
  state.status = "breakDue";
  render();
}

function takeBreakNow() {
  if (state.status !== "running") return;
  enterBreakDue(Date.now());
}

function startBreak() {
  const now = Date.now();
  state.breakStartedAt = now;
  state.breakEndsAt = now + BREAK_TARGET_MS;
  state.status = "onBreak";
  render();
}

function skipBreak() {
  state.breaksSkipped += 1;
  state.breakNumber += 1;
  state.nextBreakAt = state.breakScheduledAt + BREAK_INTERVAL_MS;
  state.status = "running";
  render();
}

function endBreak() {
  state.breaksCompleted += 1;
  state.movementMs += Date.now() - state.breakStartedAt;
  state.breakNumber += 1;
  state.nextBreakAt = Date.now() + BREAK_INTERVAL_MS;
  state.status = "running";
  render();
}

function endWorkday() {
  state.workdayEndedAt = Date.now();
  state.status = "ended";
  render();
}

function restart() {
  state.status = "idle";
  render();
}

function currentElapsedWorkdayMs(now) {
  if (!state.workdayStartedAt) return 0;
  const openPauseMs =
    state.status === "paused" && state.pauseStartedAt
      ? now - state.pauseStartedAt
      : 0;
  return now - state.workdayStartedAt - state.pausedMsTotal - openPauseMs;
}

function tick() {
  const now = Date.now();

  if (state.status === "running" && state.nextBreakAt !== null) {
    const remaining = state.nextBreakAt - now;
    if (remaining <= 0) {
      enterBreakDue(state.nextBreakAt);
      return;
    }
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
  const nextType = breakTypeForNumber(state.breakNumber + 1);
  const nextCopy = BREAK_COPY[nextType];
  el.nextBreakType.textContent = nextCopy.title;
  el.nextBreakDetail.textContent = nextCopy.nextDetail;

  if (state.status === "running" && state.nextBreakAt !== null) {
    el.countdown.textContent = formatMMSS(state.nextBreakAt - now);
  } else if (state.status === "paused" && state.pausedRemainingMs !== null) {
    el.countdown.textContent = formatMMSS(state.pausedRemainingMs);
  }

  el.statElapsed.textContent = formatMMSS(currentElapsedWorkdayMs(now));
  el.statCompleted.textContent = String(state.breaksCompleted);
  el.statSkipped.textContent = String(state.breaksSkipped);
  el.statMovementMinutes.textContent = String(
    Math.round(state.movementMs / 60000)
  );

  el.pauseBtn.classList.toggle("hidden", state.status !== "running");
  el.resumeBtn.classList.toggle("hidden", state.status !== "paused");
  el.takeBreakBtn.classList.toggle("hidden", state.status !== "running");

  const onBreakStatus = state.status === "breakDue" || state.status === "onBreak";
  el.breakOverlay.classList.toggle("hidden", !onBreakStatus);

  if (state.status === "breakDue") {
    const copy = BREAK_COPY[state.currentBreakType];
    el.breakDueView.classList.remove("hidden");
    el.breakActiveView.classList.add("hidden");
    el.breakTitle.textContent = copy.title;
    el.breakInstructions.textContent = copy.dueInstructions;
    el.breakPreferred.textContent = copy.duePreferred;

    const overdueMs = now - state.breakScheduledAt;
    if (overdueMs > OVERDUE_NOTICE_THRESHOLD_MS) {
      const overdueMinutes = Math.round(overdueMs / 60000);
      el.breakOverdueNote.textContent = `Movement break was due ${overdueMinutes} minute${overdueMinutes === 1 ? "" : "s"} ago.`;
      el.breakOverdueNote.classList.remove("hidden");
    } else {
      el.breakOverdueNote.classList.add("hidden");
    }
  }

  if (state.status === "onBreak") {
    const copy = BREAK_COPY[state.currentBreakType];
    el.breakDueView.classList.add("hidden");
    el.breakActiveView.classList.remove("hidden");
    el.breakActiveTitle.textContent = copy.title;
    el.breakActiveInstructions.textContent = copy.activeInstructions;
    el.breakCountdown.textContent = formatMMSS(state.breakEndsAt - now);
  }

  if (state.status === "ended") {
    el.summaryDuration.textContent = formatMMSS(
      state.workdayEndedAt - state.workdayStartedAt - state.pausedMsTotal
    );
    el.summaryCompleted.textContent = String(state.breaksCompleted);
    el.summarySkipped.textContent = String(state.breaksSkipped);
    el.summaryMovementMinutes.textContent = String(
      Math.round(state.movementMs / 60000)
    );
  }
}

el.startWorkdayBtn.addEventListener("click", startWorkday);
el.pauseBtn.addEventListener("click", pauseWorkday);
el.resumeBtn.addEventListener("click", resumeWorkday);
el.takeBreakBtn.addEventListener("click", takeBreakNow);
el.endWorkdayBtn.addEventListener("click", endWorkday);
el.restartBtn.addEventListener("click", restart);
el.startBreakBtn.addEventListener("click", startBreak);
el.skipBreakBtn.addEventListener("click", skipBreak);
el.endBreakBtn.addEventListener("click", endBreak);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") tick();
});
window.addEventListener("focus", tick);
window.addEventListener("pageshow", tick);

setInterval(tick, TICK_MS);
render();
