// Subway Surfers-style lane runner controlled by gaze.
import tracker from "./tracker.js";

const $ = (id) => document.getElementById(id);

const els = {
  canvas: $("game"),
  score: $("score"),
  best: $("best"),
  speed: $("speed"),
  startScreen: $("start-screen"),
  gameoverScreen: $("gameover-screen"),
  calibrateScreen: $("calibrate-screen"),
  finalScore: $("final-score"),
  status: $("status"),
  btnCalibrate: $("btn-calibrate"),
  btnStart: $("btn-start"),
  btnRetry: $("btn-retry"),
  btnCalCapture: $("btn-cal-capture"),
  btnCalCancel: $("btn-cal-cancel"),
  calTitle: $("cal-title"),
  calInstruction: $("cal-instruction"),
  calTargets: document.querySelectorAll(".cal-target"),
  gazeDot: $("gaze-dot"),
  gazeLabel: $("gaze-label"),
  webcam: $("webcam"),
  overlay: $("overlay"),
};

// ----- Game state -----
const NUM_LANES = 3;
const state = {
  running: false,
  over: false,
  score: 0,
  best: Number(localStorage.getItem("eye-subway:best") || 0),
  laneIndex: 1, // 0=left, 1=center, 2=right
  laneTargetIndex: 1,
  laneTransition: 0, // 0..1 progress
  speed: 1.0,
  obstacles: [],
  coins: [],
  spawnTimer: 0,
  coinTimer: 0,
  scrollY: 0,
  lastTimestamp: 0,
  // Held-direction debounce: only switch lanes when gaze stays on a side.
  lastInputLane: 0,
  inputHoldTime: 0,
};

els.best.textContent = state.best;

// ----- Canvas setup with DPR -----
const ctx = els.canvas.getContext("2d");
function resize() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = els.canvas.getBoundingClientRect();
  els.canvas.width = Math.floor(rect.width * dpr);
  els.canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
resize();

// ----- Tracker setup -----
async function bootTracker() {
  try {
    els.status.textContent = "웹캠 권한 요청 중...";
    await tracker.start({ video: els.webcam, overlay: els.overlay });
    const hadCal = tracker.loadCalibration();
    els.status.textContent = hadCal
      ? "이전 보정값을 불러왔습니다. 바로 시작하거나 다시 보정하세요."
      : "보정을 진행한 뒤 게임을 시작하세요.";
    els.btnStart.disabled = false;
    els.btnCalibrate.disabled = false;
  } catch (e) {
    console.error(e);
    els.status.textContent = "웹캠을 사용할 수 없습니다: " + e.message;
  }
}
bootTracker();

tracker.on(({ lane, norm, faceVisible }) => {
  // Update HUD gaze indicator (visual feedback).
  // norm: -1 (user looking left) .. +1 (user looking right).
  const pct = ((norm + 1) / 2) * 100;
  els.gazeDot.style.left = `${Math.max(0, Math.min(100, pct))}%`;
  els.gazeLabel.textContent = !faceVisible
    ? "NO FACE"
    : lane === -1 ? "LEFT" : lane === 1 ? "RIGHT" : "CENTER";
});

// ----- Calibration UX -----
const CAL_STEPS = [
  { key: "left", label: "왼쪽 점을 바라보세요" },
  { key: "center", label: "가운데 점을 바라보세요" },
  { key: "right", label: "오른쪽 점을 바라보세요" },
];
let calStep = 0;

function openCalibration() {
  calStep = 0;
  els.calibrateScreen.classList.remove("hidden");
  updateCalUI();
}

function updateCalUI() {
  const step = CAL_STEPS[calStep];
  els.calTitle.textContent = `보정 ${calStep + 1} / ${CAL_STEPS.length}`;
  els.calInstruction.textContent = step.label;
  els.calTargets.forEach((el) => {
    el.classList.remove("active", "done");
    const t = el.dataset.target;
    const idx = CAL_STEPS.findIndex((s) => s.key === t);
    if (idx < calStep) el.classList.add("done");
    if (idx === calStep) el.classList.add("active");
  });
}

els.btnCalibrate.addEventListener("click", openCalibration);
els.btnCalCancel.addEventListener("click", () => els.calibrateScreen.classList.add("hidden"));
els.btnCalCapture.addEventListener("click", () => {
  const step = CAL_STEPS[calStep];
  tracker.capture(step.key);
  calStep++;
  if (calStep >= CAL_STEPS.length) {
    tracker.saveCalibration();
    els.calibrateScreen.classList.add("hidden");
    els.status.textContent = "보정 완료! 게임을 시작하세요.";
    els.btnStart.disabled = false;
  } else {
    updateCalUI();
  }
});

// ----- Start / restart -----
els.btnStart.addEventListener("click", () => {
  els.startScreen.classList.add("hidden");
  startGame();
});
els.btnRetry.addEventListener("click", () => {
  els.gameoverScreen.classList.add("hidden");
  startGame();
});

function startGame() {
  state.running = true;
  state.over = false;
  state.score = 0;
  state.speed = 1.0;
  state.obstacles = [];
  state.coins = [];
  state.spawnTimer = 0;
  state.coinTimer = 0;
  state.scrollY = 0;
  state.laneIndex = 1;
  state.laneTargetIndex = 1;
  state.laneTransition = 1;
  state.lastTimestamp = performance.now();
  requestAnimationFrame(loop);
}

function gameOver() {
  state.running = false;
  state.over = true;
  const finalScore = Math.floor(state.score);
  els.finalScore.textContent = finalScore;
  if (finalScore > state.best) {
    state.best = finalScore;
    els.best.textContent = state.best;
    localStorage.setItem("eye-subway:best", state.best);
  }
  els.gameoverScreen.classList.remove("hidden");
}

// ----- Input handling: gaze + keyboard -----
const HOLD_TO_SWITCH_MS = 90; // gaze must persist this long before lane changes.
function readInputLane() {
  return tracker.getLane(); // -1 / 0 / +1
}

function tryMoveLane(dir) {
  const target = Math.max(0, Math.min(NUM_LANES - 1, state.laneTargetIndex + dir));
  if (target !== state.laneTargetIndex) {
    state.laneIndex = state.laneTargetIndex;
    state.laneTargetIndex = target;
    state.laneTransition = 0;
  }
}

window.addEventListener("keydown", (e) => {
  if (!state.running) return;
  if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") tryMoveLane(-1);
  else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") tryMoveLane(+1);
});

// ----- Game loop -----
function loop(ts) {
  if (!state.running) return;
  const dt = Math.min(50, ts - state.lastTimestamp);
  state.lastTimestamp = ts;

  update(dt);
  render();

  requestAnimationFrame(loop);
}

function update(dt) {
  // Gaze input -> debounced lane switching.
  const gazeLane = readInputLane();
  if (gazeLane !== 0 && gazeLane === state.lastInputLane) {
    state.inputHoldTime += dt;
    if (state.inputHoldTime >= HOLD_TO_SWITCH_MS) {
      tryMoveLane(gazeLane);
      // After firing, require user to recenter before next switch.
      state.lastInputLane = 0;
      state.inputHoldTime = 0;
    }
  } else {
    state.lastInputLane = gazeLane;
    state.inputHoldTime = 0;
  }

  // Lane transition smoothing.
  state.laneTransition = Math.min(1, state.laneTransition + dt / 160);

  // Speed/Difficulty.
  state.speed = 1.0 + Math.min(2.5, state.score / 600);
  els.speed.textContent = state.speed.toFixed(1) + "x";

  const baseScroll = 0.45; // px per ms baseline
  const scrollDelta = baseScroll * state.speed * dt;
  state.scrollY += scrollDelta;
  state.score += scrollDelta * 0.05;
  els.score.textContent = Math.floor(state.score);

  // Spawn obstacles.
  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    spawnObstacleRow();
    state.spawnTimer = 700 / state.speed; // tighter at higher speed
  }
  // Spawn coins occasionally.
  state.coinTimer -= dt;
  if (state.coinTimer <= 0) {
    spawnCoinTrail();
    state.coinTimer = 1300 / state.speed;
  }

  // Move world objects "down" by simulating: increase their world y as scroll grows;
  // we just advance scrollY and treat object.y as world coords. Their on-screen y
  // is computed in render() using scrollY.

  // Cull off-screen.
  state.obstacles = state.obstacles.filter((o) => o.worldY > state.scrollY - 200);
  state.coins = state.coins.filter((c) => c.worldY > state.scrollY - 100 && !c.collected);

  // Collision check.
  const playerLaneNow = currentPlayerLaneFloat();
  for (const o of state.obstacles) {
    const onScreenY = worldToScreenY(o.worldY);
    if (onScreenY > playerScreenY() - 36 && onScreenY < playerScreenY() + 36) {
      // overlap with player lane?
      const laneDist = Math.abs(o.lane - playerLaneNow);
      if (laneDist < 0.55) {
        gameOver();
        return;
      }
    }
  }
  for (const c of state.coins) {
    if (c.collected) continue;
    const onScreenY = worldToScreenY(c.worldY);
    if (onScreenY > playerScreenY() - 30 && onScreenY < playerScreenY() + 30) {
      const laneDist = Math.abs(c.lane - playerLaneNow);
      if (laneDist < 0.5) {
        c.collected = true;
        state.score += 25;
      }
    }
  }
}

function spawnObstacleRow() {
  // Spawn 1 or 2 obstacles in different lanes ahead so there's always a free lane.
  const lanes = [0, 1, 2];
  const blockCount = Math.random() < 0.3 ? 2 : 1;
  // Pick `blockCount` distinct lanes; ensure at least one is free.
  const picked = new Set();
  while (picked.size < blockCount) {
    picked.add(lanes[Math.floor(Math.random() * 3)]);
  }
  const aheadWorldY = state.scrollY + canvasH() + 40;
  for (const lane of picked) {
    state.obstacles.push({
      lane,
      worldY: aheadWorldY,
      kind: Math.random() < 0.4 ? "barrier" : "block",
    });
  }
}

function spawnCoinTrail() {
  const lane = Math.floor(Math.random() * 3);
  const startY = state.scrollY + canvasH() + 40;
  const count = 4;
  for (let i = 0; i < count; i++) {
    state.coins.push({ lane, worldY: startY + i * 70, collected: false });
  }
}

// ----- Render -----
function canvasW() { return els.canvas.clientWidth; }
function canvasH() { return els.canvas.clientHeight; }

function laneCenterX(laneIdx) {
  const w = canvasW();
  const trackWidth = Math.min(w * 0.7, 520);
  const trackLeft = (w - trackWidth) / 2;
  const laneWidth = trackWidth / NUM_LANES;
  return trackLeft + laneWidth * (laneIdx + 0.5);
}

function currentPlayerLaneFloat() {
  // ease lane transition.
  const t = easeOutCubic(state.laneTransition);
  return state.laneIndex + (state.laneTargetIndex - state.laneIndex) * t;
}

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

function playerScreenY() {
  return canvasH() - 110;
}

function worldToScreenY(worldY) {
  // Player is at fixed screen Y; world scrolls "down" as scrollY grows.
  // Larger worldY means farther ahead (further "up" the track in 2D top-down view).
  // We render a top-down strip where player is near bottom and obstacles travel down.
  const playerWorldY = state.scrollY; // anchor
  return playerScreenY() - (worldY - playerWorldY);
}

function render() {
  const w = canvasW();
  const h = canvasH();

  // Sky gradient backdrop.
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#1a2a5c");
  sky.addColorStop(0.6, "#0d1430");
  sky.addColorStop(1, "#060914");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  drawStars(w, h);
  drawTrack(w, h);
  drawCoinsAndObstacles(w, h);
  drawPlayer(w, h);
  drawSideHints(w, h);
}

function drawStars(w, h) {
  // Simple parallax stars.
  if (!drawStars.cache) {
    drawStars.cache = Array.from({ length: 80 }, () => ({
      x: Math.random(),
      y: Math.random() * 0.55,
      r: Math.random() * 1.4 + 0.3,
      s: Math.random() * 0.4 + 0.1,
    }));
  }
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  for (const st of drawStars.cache) {
    const y = ((st.y * h + state.scrollY * 0.05 * st.s) % h + h) % h;
    ctx.globalAlpha = 0.4 + 0.6 * st.s;
    ctx.beginPath();
    ctx.arc(st.x * w, y, st.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawTrack(w, h) {
  const trackWidth = Math.min(w * 0.7, 520);
  const trackLeft = (w - trackWidth) / 2;
  const laneWidth = trackWidth / NUM_LANES;

  // Track base
  ctx.fillStyle = "#0e1430";
  ctx.fillRect(trackLeft, 0, trackWidth, h);

  // Side walls
  ctx.fillStyle = "rgba(74, 216, 255, 0.18)";
  ctx.fillRect(trackLeft - 6, 0, 6, h);
  ctx.fillRect(trackLeft + trackWidth, 0, 6, h);

  // Moving lane separators (dashed lines).
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.lineWidth = 3;
  const dashLen = 28;
  const gap = 22;
  const period = dashLen + gap;
  const offset = (state.scrollY % period);
  for (let i = 1; i < NUM_LANES; i++) {
    const x = trackLeft + i * laneWidth;
    ctx.beginPath();
    for (let y = -period + offset; y < h + period; y += period) {
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + dashLen);
    }
    ctx.stroke();
  }

  // Horizon / vanishing fog
  const fog = ctx.createLinearGradient(0, 0, 0, h * 0.5);
  fog.addColorStop(0, "rgba(6,9,20,0.95)");
  fog.addColorStop(1, "rgba(6,9,20,0)");
  ctx.fillStyle = fog;
  ctx.fillRect(trackLeft - 6, 0, trackWidth + 12, h * 0.5);
}

function drawCoinsAndObstacles(w, h) {
  const trackWidth = Math.min(w * 0.7, 520);
  const trackLeft = (w - trackWidth) / 2;
  const laneWidth = trackWidth / NUM_LANES;

  for (const o of state.obstacles) {
    const cx = trackLeft + laneWidth * (o.lane + 0.5);
    const cy = worldToScreenY(o.worldY);
    if (cy < -80 || cy > h + 80) continue;
    drawObstacle(cx, cy, o.kind, laneWidth);
  }
  for (const c of state.coins) {
    if (c.collected) continue;
    const cx = trackLeft + laneWidth * (c.lane + 0.5);
    const cy = worldToScreenY(c.worldY);
    if (cy < -40 || cy > h + 40) continue;
    drawCoin(cx, cy);
  }
}

function drawObstacle(cx, cy, kind, laneWidth) {
  const wd = Math.min(70, laneWidth * 0.7);
  const hd = kind === "barrier" ? 26 : 60;
  ctx.save();
  ctx.translate(cx, cy);
  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.ellipse(0, hd / 2 + 6, wd / 2, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  if (kind === "barrier") {
    // Striped barrier
    ctx.fillStyle = "#ff5577";
    roundRect(-wd / 2, -hd / 2, wd, hd, 6);
    ctx.fill();
    ctx.fillStyle = "#fff";
    for (let i = -wd / 2; i < wd / 2; i += 14) {
      ctx.beginPath();
      ctx.moveTo(i, -hd / 2);
      ctx.lineTo(i + 8, -hd / 2);
      ctx.lineTo(i + 14, hd / 2);
      ctx.lineTo(i + 6, hd / 2);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    // Crate
    const grad = ctx.createLinearGradient(0, -hd / 2, 0, hd / 2);
    grad.addColorStop(0, "#ffb547");
    grad.addColorStop(1, "#c97a14");
    ctx.fillStyle = grad;
    roundRect(-wd / 2, -hd / 2, wd, hd, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-wd / 2 + 4, -hd / 2 + 4);
    ctx.lineTo(wd / 2 - 4, hd / 2 - 4);
    ctx.moveTo(wd / 2 - 4, -hd / 2 + 4);
    ctx.lineTo(-wd / 2 + 4, hd / 2 - 4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCoin(cx, cy) {
  const t = performance.now() / 200;
  const r = 12;
  const sx = Math.abs(Math.cos(t + cy * 0.01));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = "#ffd24a";
  ctx.beginPath();
  ctx.ellipse(0, 0, r * sx, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillRect(-2 * sx, -5, 4 * sx, 10);
  ctx.restore();
}

function drawPlayer(w, h) {
  const laneFloat = currentPlayerLaneFloat();
  const cx = laneCenterX(laneFloat);
  const cy = playerScreenY();
  const bob = Math.sin(performance.now() / 120) * 3;

  ctx.save();
  ctx.translate(cx, cy + bob);
  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.beginPath();
  ctx.ellipse(0, 30, 26, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // body
  const bodyGrad = ctx.createLinearGradient(0, -30, 0, 30);
  bodyGrad.addColorStop(0, "#4ad8ff");
  bodyGrad.addColorStop(1, "#1d6cf3");
  ctx.fillStyle = bodyGrad;
  roundRect(-22, -28, 44, 56, 12);
  ctx.fill();

  // head
  ctx.fillStyle = "#ffd9b5";
  ctx.beginPath();
  ctx.arc(0, -38, 14, 0, Math.PI * 2);
  ctx.fill();

  // hat
  ctx.fillStyle = "#ff5577";
  roundRect(-15, -52, 30, 8, 3);
  ctx.fill();
  roundRect(-9, -58, 18, 8, 4);
  ctx.fill();

  // eyes (look in gaze direction)
  const norm = clamp(tracker.getNormalizedRatio?.() ?? 0, -1, 1);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(-5, -38, 3, 0, Math.PI * 2);
  ctx.arc(5, -38, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0a0e1a";
  ctx.beginPath();
  ctx.arc(-5 + norm * 1.5, -38, 1.5, 0, Math.PI * 2);
  ctx.arc(5 + norm * 1.5, -38, 1.5, 0, Math.PI * 2);
  ctx.fill();

  // arms - sway
  const sway = Math.sin(performance.now() / 110) * 0.5;
  ctx.fillStyle = "#1d6cf3";
  ctx.save();
  ctx.translate(-22, -10);
  ctx.rotate(sway * 0.4);
  roundRect(-6, 0, 10, 28, 5);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(22, -10);
  ctx.rotate(-sway * 0.4);
  roundRect(-4, 0, 10, 28, 5);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

function drawSideHints(w, h) {
  const lane = tracker.getLane?.() ?? 0;
  ctx.save();
  if (lane === -1) {
    const g = ctx.createLinearGradient(0, 0, w * 0.25, 0);
    g.addColorStop(0, "rgba(74,216,255,0.35)");
    g.addColorStop(1, "rgba(74,216,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w * 0.25, h);
  } else if (lane === 1) {
    const g = ctx.createLinearGradient(w, 0, w * 0.75, 0);
    g.addColorStop(0, "rgba(74,216,255,0.35)");
    g.addColorStop(1, "rgba(74,216,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(w * 0.75, 0, w * 0.25, h);
  }
  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Idle render (for start screen background animation).
(function idleRender() {
  if (!state.running) {
    state.scrollY += 1.2;
    render();
  }
  requestAnimationFrame(idleRender);
})();
