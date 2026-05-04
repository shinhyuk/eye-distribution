// Eye-controlled 2-lane KartRider-style pseudo-3D runner.
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

// ----- World / camera constants -----
const NUM_LANES = 2;
const TRACK_HALF_W = 240;            // track half-width in world units (=px at z=0)
const LANE_OFFSETS = [-120, 120];     // worldX of each lane center
const HORIZON_RATIO = 0.42;           // where horizon sits (% of canvas h)
const VIS_DEPTH = 320;                // pseudo-3D scale factor (z-units = px)
const SPAWN_Z = 1500;                 // distance ahead at which obstacles spawn
const ROAD_SEGMENT = 70;              // length of one dashed segment in z-units

// ----- Game state -----
const state = {
  running: false,
  over: false,
  score: 0,
  best: Number(localStorage.getItem("eye-subway:best") || 0),
  laneIndex: 0,           // 0 = left, 1 = right
  laneTargetIndex: 0,
  laneTransition: 1,
  speed: 1.0,
  obstacles: [],
  coins: [],
  spawnTimer: 0,
  coinTimer: 0,
  scrollZ: 0,
  lastTimestamp: 0,
  lastInputLane: 0,
  inputHoldTime: 0,
};

els.best.textContent = state.best;

// ----- Canvas with DPR -----
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

function canvasW() { return els.canvas.clientWidth; }
function canvasH() { return els.canvas.clientHeight; }

// ----- Tracker (lazy boot for iOS) -----
let trackerReady = false;
let trackerStarting = null;

async function ensureTracker() {
  if (trackerReady) return true;
  if (trackerStarting) return trackerStarting;
  trackerStarting = (async () => {
    try {
      els.status.textContent = "웹캠 권한을 허용해 주세요...";
      await tracker.start({ video: els.webcam, overlay: els.overlay });
      const hadCal = tracker.loadCalibration();
      els.status.textContent = hadCal
        ? "이전 보정값 사용 중. 다시 보정하면 더 정확해요."
        : "보정을 한 번 진행하면 더 정확해집니다.";
      trackerReady = true;
      return true;
    } catch (e) {
      console.error(e);
      els.status.textContent = "웹캠을 사용할 수 없습니다: " + (e?.message || e);
      throw e;
    } finally {
      trackerStarting = null;
    }
  })();
  return trackerStarting;
}

els.status.textContent = "‘게임 시작’을 누르면 웹캠 권한 요청이 뜹니다.";
els.btnStart.disabled = false;
els.btnCalibrate.disabled = false;

tracker.on(({ lane, norm, faceVisible }) => {
  const pct = ((norm + 1) / 2) * 100;
  els.gazeDot.style.left = `${Math.max(0, Math.min(100, pct))}%`;
  els.gazeLabel.textContent = !faceVisible
    ? "NO FACE"
    : lane === -1 ? "LEFT" : lane === 1 ? "RIGHT" : "CENTER";
});

// ----- Calibration -----
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

els.btnCalibrate.addEventListener("click", async () => {
  try { await ensureTracker(); } catch { return; }
  openCalibration();
});
els.btnCalCancel.addEventListener("click", () => els.calibrateScreen.classList.add("hidden"));
els.btnCalCapture.addEventListener("click", () => {
  const step = CAL_STEPS[calStep];
  tracker.capture(step.key);
  calStep++;
  if (calStep >= CAL_STEPS.length) {
    tracker.saveCalibration();
    els.calibrateScreen.classList.add("hidden");
    els.status.textContent = "보정 완료! 게임을 시작하세요.";
  } else {
    updateCalUI();
  }
});

// ----- Start / restart -----
els.btnStart.addEventListener("click", async () => {
  try { await ensureTracker(); } catch { return; }
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
  state.scrollZ = 0;
  state.laneIndex = 0;
  state.laneTargetIndex = 0;
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

// ----- Input -----
const HOLD_TO_SWITCH_MS = 80;
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
  // Gaze input -> debounced lane change.
  const gazeLane = tracker.getLane();
  if (gazeLane !== 0 && gazeLane === state.lastInputLane) {
    state.inputHoldTime += dt;
    if (state.inputHoldTime >= HOLD_TO_SWITCH_MS) {
      tryMoveLane(gazeLane);
      state.lastInputLane = 0;
      state.inputHoldTime = 0;
    }
  } else {
    state.lastInputLane = gazeLane;
    state.inputHoldTime = 0;
  }

  state.laneTransition = Math.min(1, state.laneTransition + dt / 180);

  // Speed ramps up with score.
  state.speed = 1.0 + Math.min(2.5, state.score / 700);
  els.speed.textContent = state.speed.toFixed(1) + "x";

  const baseScroll = 0.6;
  const scrollDelta = baseScroll * state.speed * dt;
  state.scrollZ += scrollDelta;
  state.score += scrollDelta * 0.05;
  els.score.textContent = Math.floor(state.score);

  // Move all world objects toward the camera.
  for (const o of state.obstacles) o.z -= scrollDelta;
  for (const c of state.coins) c.z -= scrollDelta;

  // Spawn obstacles (one lane only — guarantees a free lane in 2-lane mode).
  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    spawnObstacle();
    state.spawnTimer = 760 / state.speed;
  }
  state.coinTimer -= dt;
  if (state.coinTimer <= 0) {
    spawnCoinTrail();
    state.coinTimer = 1300 / state.speed;
  }

  // Cull what passed the camera.
  state.obstacles = state.obstacles.filter((o) => o.z > -120);
  state.coins = state.coins.filter((c) => c.z > -60 && !c.collected);

  // Collisions.
  const playerLaneFloat = currentPlayerLaneFloat();
  for (const o of state.obstacles) {
    if (o.z < 50 && o.z > -30) {
      if (Math.abs(o.lane - playerLaneFloat) < 0.5) {
        gameOver();
        return;
      }
    }
  }
  for (const c of state.coins) {
    if (c.collected) continue;
    if (c.z < 40 && c.z > -20) {
      if (Math.abs(c.lane - playerLaneFloat) < 0.55) {
        c.collected = true;
        state.score += 25;
      }
    }
  }
}

function spawnObstacle() {
  const lane = Math.random() < 0.5 ? 0 : 1;
  const kind = Math.random() < 0.4 ? "barrier" : "block";
  state.obstacles.push({ z: SPAWN_Z, lane, kind });
}
function spawnCoinTrail() {
  const lane = Math.random() < 0.5 ? 0 : 1;
  const count = 5;
  for (let i = 0; i < count; i++) {
    state.coins.push({ z: SPAWN_Z + i * 90, lane, collected: false });
  }
}

// ----- Pseudo-3D projection -----
function horizonY() { return canvasH() * HORIZON_RATIO; }
function groundY() { return canvasH() - 90; } // where z=0 plane meets screen
function projScale(z) {
  const visD = VIS_DEPTH;
  return visD / Math.max(1, visD + z);
}
function projY(z) {
  const hor = horizonY();
  return hor + (groundY() - hor) * projScale(z);
}
function projX(worldX, z) {
  return canvasW() / 2 + worldX * projScale(z);
}

function currentPlayerLaneFloat() {
  const t = easeOutCubic(state.laneTransition);
  return state.laneIndex + (state.laneTargetIndex - state.laneIndex) * t;
}
function currentPlayerWorldX() {
  const t = easeOutCubic(state.laneTransition);
  return LANE_OFFSETS[state.laneIndex] * (1 - t) + LANE_OFFSETS[state.laneTargetIndex] * t;
}
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

// ----- Rendering -----
function render() {
  const w = canvasW();
  const h = canvasH();

  drawSky(w, h);
  drawGround(w, h);
  drawRoad(w, h);
  drawScenery(w, h);

  // Z-sort renderables back-to-front (further first).
  const items = [];
  for (const o of state.obstacles) items.push({ z: o.z, kind: "obstacle", data: o });
  for (const c of state.coins) if (!c.collected) items.push({ z: c.z, kind: "coin", data: c });
  items.sort((a, b) => b.z - a.z);
  for (const it of items) {
    if (it.z > SPAWN_Z + 50) continue;
    if (it.kind === "obstacle") drawObstacle(it.data);
    else drawCoin(it.data);
  }

  drawKart(w, h);
  drawSideHints(w, h);
}

function drawSky(w, h) {
  const hor = horizonY();
  const sky = ctx.createLinearGradient(0, 0, 0, hor);
  sky.addColorStop(0, "#0a1238");
  sky.addColorStop(0.55, "#28346d");
  sky.addColorStop(1, "#ff7a5c");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, hor);

  // distant sun
  ctx.fillStyle = "rgba(255, 200, 130, 0.55)";
  ctx.beginPath();
  ctx.arc(w * 0.62, hor - 18, 36, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 220, 170, 0.85)";
  ctx.beginPath();
  ctx.arc(w * 0.62, hor - 18, 22, 0, Math.PI * 2);
  ctx.fill();

  // stars (parallax-y)
  if (!drawSky.cache) {
    drawSky.cache = Array.from({ length: 60 }, () => ({
      x: Math.random(), y: Math.random() * 0.5, r: Math.random() * 1.3 + 0.3,
    }));
  }
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  for (const s of drawSky.cache) {
    ctx.globalAlpha = 0.35 + 0.5 * (1 - s.y * 2);
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * hor, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawGround(w, h) {
  const hor = horizonY();
  const grad = ctx.createLinearGradient(0, hor, 0, h);
  grad.addColorStop(0, "#0d2a1f");
  grad.addColorStop(1, "#06120d");
  ctx.fillStyle = grad;
  ctx.fillRect(0, hor, w, h - hor);

  // grid lines on ground (extends from horizon outward).
  ctx.strokeStyle = "rgba(74, 216, 255, 0.10)";
  ctx.lineWidth = 1;
  const offset = (state.scrollZ * 0.5) % ROAD_SEGMENT;
  for (let i = 0; i < 28; i++) {
    const z = i * ROAD_SEGMENT - offset;
    if (z < -10) continue;
    const y = projY(z);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function drawRoad(w, h) {
  const hor = horizonY();
  const cx = w / 2;

  // Extend trapezoid below z=0 down to canvas bottom.
  const farTopY = hor;
  const farTopHalf = 0.5;
  const groundHalf = TRACK_HALF_W;
  const bottomY = h;
  const bottomHalf = TRACK_HALF_W * (bottomY - hor) / Math.max(1, groundY() - hor);

  // Asphalt fill (filled trapezoid extending past camera).
  ctx.fillStyle = "#101737";
  ctx.beginPath();
  ctx.moveTo(cx - farTopHalf, farTopY);
  ctx.lineTo(cx + farTopHalf, farTopY);
  ctx.lineTo(cx + bottomHalf, bottomY);
  ctx.lineTo(cx - bottomHalf, bottomY);
  ctx.closePath();
  ctx.fill();

  // Rumble strips on each shoulder + dashed center divider.
  const segOffset = state.scrollZ % ROAD_SEGMENT;
  const segCount = 26;

  for (let i = 0; i < segCount; i++) {
    const zNear = i * ROAD_SEGMENT - segOffset;
    const zFar = zNear + ROAD_SEGMENT;
    if (zFar < -10) continue;
    const yNear = projY(Math.max(0, zNear));
    const yFar = projY(Math.max(0, zFar));
    if (yFar > yNear - 0.4) continue; // skip degenerate

    const halfNear = TRACK_HALF_W * projScale(Math.max(0, zNear));
    const halfFar = TRACK_HALF_W * projScale(Math.max(0, zFar));
    const stripe = (i % 2 === 0);

    // Outer rumble strips (red/white).
    ctx.fillStyle = stripe ? "#ff5577" : "#ffffff";
    // left rumble
    ctx.beginPath();
    ctx.moveTo(cx - halfFar - 6 * projScale(zFar), yFar);
    ctx.lineTo(cx - halfNear - 6 * projScale(zNear), yNear);
    ctx.lineTo(cx - halfNear, yNear);
    ctx.lineTo(cx - halfFar, yFar);
    ctx.closePath();
    ctx.fill();
    // right rumble
    ctx.beginPath();
    ctx.moveTo(cx + halfFar, yFar);
    ctx.lineTo(cx + halfNear, yNear);
    ctx.lineTo(cx + halfNear + 6 * projScale(zNear), yNear);
    ctx.lineTo(cx + halfFar + 6 * projScale(zFar), yFar);
    ctx.closePath();
    ctx.fill();

    // Asphalt tone alternation (subtle).
    ctx.fillStyle = stripe ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0)";
    ctx.beginPath();
    ctx.moveTo(cx - halfFar, yFar);
    ctx.lineTo(cx + halfFar, yFar);
    ctx.lineTo(cx + halfNear, yNear);
    ctx.lineTo(cx - halfNear, yNear);
    ctx.closePath();
    ctx.fill();

    // Dashed center divider — only on stripe segments.
    if (stripe) {
      const wNear = 6 * projScale(Math.max(0, zNear));
      const wFar = 6 * projScale(Math.max(0, zFar));
      ctx.fillStyle = "#ffd24a";
      ctx.beginPath();
      ctx.moveTo(cx - wFar / 2, yFar);
      ctx.lineTo(cx + wFar / 2, yFar);
      ctx.lineTo(cx + wNear / 2, yNear);
      ctx.lineTo(cx - wNear / 2, yNear);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Extend rumble + asphalt past z=0 down to canvas bottom (linear).
  ctx.strokeStyle = "#ff5577";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(cx - groundHalf, groundY());
  ctx.lineTo(cx - bottomHalf, bottomY);
  ctx.moveTo(cx + groundHalf, groundY());
  ctx.lineTo(cx + bottomHalf, bottomY);
  ctx.stroke();

  // Soft horizon glow.
  const glow = ctx.createLinearGradient(0, hor - 30, 0, hor + 30);
  glow.addColorStop(0, "rgba(255, 180, 90, 0)");
  glow.addColorStop(0.5, "rgba(255, 180, 90, 0.55)");
  glow.addColorStop(1, "rgba(255, 180, 90, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, hor - 30, w, 60);
}

function drawScenery(w, h) {
  // Roadside posts to enhance speed perception.
  const segOffset = state.scrollZ % (ROAD_SEGMENT * 2);
  for (let i = 0; i < 14; i++) {
    const z = i * ROAD_SEGMENT * 2 - segOffset;
    if (z < 0 || z > 1800) continue;
    const s = projScale(z);
    const y = projY(z);
    const halfW = (TRACK_HALF_W + 22) * s;

    const poleH = 28 * s;
    const poleW = Math.max(1, 3 * s);
    ctx.fillStyle = "rgba(74, 216, 255, 0.55)";
    ctx.fillRect(canvasW() / 2 - halfW - poleW / 2, y - poleH, poleW, poleH);
    ctx.fillRect(canvasW() / 2 + halfW - poleW / 2, y - poleH, poleW, poleH);

    // light tip
    ctx.fillStyle = "#4ad8ff";
    const tip = Math.max(1, 4 * s);
    ctx.beginPath();
    ctx.arc(canvasW() / 2 - halfW, y - poleH, tip, 0, Math.PI * 2);
    ctx.arc(canvasW() / 2 + halfW, y - poleH, tip, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawObstacle(o) {
  if (o.z > SPAWN_Z + 10 || o.z < -120) return;
  const s = projScale(Math.max(0, o.z));
  const x = projX(LANE_OFFSETS[o.lane], Math.max(0, o.z));
  const y = projY(Math.max(0, o.z));

  ctx.save();
  ctx.translate(x, y);
  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.ellipse(0, 8 * s, 38 * s, 8 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  if (o.kind === "barrier") {
    const wd = 90 * s, hd = 32 * s;
    ctx.fillStyle = "#ff5577";
    roundRect(-wd / 2, -hd, wd, hd, 4 * s);
    ctx.fill();
    ctx.fillStyle = "#fff";
    for (let i = -wd / 2; i < wd / 2; i += 18 * s) {
      ctx.beginPath();
      ctx.moveTo(i, -hd);
      ctx.lineTo(i + 10 * s, -hd);
      ctx.lineTo(i + 18 * s, 0);
      ctx.lineTo(i + 8 * s, 0);
      ctx.closePath();
      ctx.fill();
    }
    // legs
    ctx.fillStyle = "#222";
    ctx.fillRect(-wd / 2 + 2 * s, 0, 4 * s, 6 * s);
    ctx.fillRect(wd / 2 - 6 * s, 0, 4 * s, 6 * s);
  } else {
    // crate
    const wd = 70 * s, hd = 70 * s;
    const grad = ctx.createLinearGradient(0, -hd, 0, 0);
    grad.addColorStop(0, "#ffb547");
    grad.addColorStop(1, "#a85e0a");
    ctx.fillStyle = grad;
    roundRect(-wd / 2, -hd, wd, hd, 6 * s);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(-wd / 2 + 4 * s, -hd + 4 * s);
    ctx.lineTo(wd / 2 - 4 * s, -4 * s);
    ctx.moveTo(wd / 2 - 4 * s, -hd + 4 * s);
    ctx.lineTo(-wd / 2 + 4 * s, -4 * s);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCoin(c) {
  const s = projScale(Math.max(0, c.z));
  const x = projX(LANE_OFFSETS[c.lane], Math.max(0, c.z));
  const y = projY(Math.max(0, c.z)) - 18 * s;
  const t = performance.now() / 200;
  const sx = Math.abs(Math.cos(t + c.z * 0.01));
  const r = 14 * s;

  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#ffd24a";
  ctx.beginPath();
  ctx.ellipse(0, 0, r * sx, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.lineWidth = 1.5 * s;
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.fillRect(-2 * sx, -5 * s, 4 * sx, 10 * s);
  ctx.restore();
}

function drawKart(w, h) {
  const wx = currentPlayerWorldX();
  const cx = projX(wx, 0);
  const cy = projY(0);

  // steering tilt: based on lane transition direction
  const dirSign = state.laneTargetIndex - state.laneIndex; // -1, 0, +1
  const tilt = dirSign * (1 - state.laneTransition) * 0.18;
  const bob = Math.sin(performance.now() / 110) * 1.2;

  ctx.save();
  ctx.translate(cx, cy + bob);
  ctx.rotate(tilt);

  // ground shadow
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.ellipse(0, 30, 58, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Rear wheels
  ctx.fillStyle = "#0c0e16";
  roundRect(-52, -2, 16, 30, 4); ctx.fill();
  roundRect(36, -2, 16, 30, 4); ctx.fill();
  // wheel rims
  ctx.fillStyle = "#4ad8ff";
  ctx.beginPath();
  ctx.arc(-44, 14, 4, 0, Math.PI * 2);
  ctx.arc(44, 14, 4, 0, Math.PI * 2);
  ctx.fill();

  // Body — trapezoid (wider at rear because we look from behind)
  const bodyGrad = ctx.createLinearGradient(0, -38, 0, 24);
  bodyGrad.addColorStop(0, "#79e7ff");
  bodyGrad.addColorStop(0.6, "#2192ff");
  bodyGrad.addColorStop(1, "#0e3da8");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(-46, 24);
  ctx.lineTo(46, 24);
  ctx.lineTo(34, -32);
  ctx.lineTo(-34, -32);
  ctx.closePath();
  ctx.fill();

  // Body trim (highlight on top edge)
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-32, -30);
  ctx.lineTo(32, -30);
  ctx.stroke();

  // Rear bumper
  ctx.fillStyle = "#0a0e1a";
  roundRect(-48, 18, 96, 10, 3);
  ctx.fill();
  // tail lights
  ctx.fillStyle = "#ff5577";
  ctx.beginPath();
  ctx.arc(-36, 23, 3.5, 0, Math.PI * 2);
  ctx.arc(36, 23, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // Cockpit / windshield
  const wsGrad = ctx.createLinearGradient(0, -32, 0, -8);
  wsGrad.addColorStop(0, "rgba(180, 230, 255, 0.85)");
  wsGrad.addColorStop(1, "rgba(40, 80, 140, 0.7)");
  ctx.fillStyle = wsGrad;
  ctx.beginPath();
  ctx.moveTo(-26, -8);
  ctx.lineTo(26, -8);
  ctx.lineTo(20, -30);
  ctx.lineTo(-20, -30);
  ctx.closePath();
  ctx.fill();

  // Driver helmet
  ctx.fillStyle = "#ff5577";
  ctx.beginPath();
  ctx.arc(0, -22, 12, Math.PI, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(0, -22, 12, Math.PI * 1.05, Math.PI * 1.45);
  ctx.fill();

  // Exhaust glow (boost)
  const boostA = Math.min(1, (state.speed - 1) / 2);
  if (boostA > 0.05) {
    ctx.fillStyle = `rgba(74, 216, 255, ${0.45 * boostA})`;
    ctx.beginPath();
    ctx.ellipse(-22, 30, 6, 9 + boostA * 8, 0, 0, Math.PI * 2);
    ctx.ellipse(22, 30, 6, 9 + boostA * 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  // Speed lines
  drawSpeedLines(w, h);
}

function drawSpeedLines(w, h) {
  const intensity = Math.min(1, (state.speed - 1) / 2);
  if (intensity < 0.1) return;
  ctx.strokeStyle = `rgba(255,255,255,${0.18 * intensity})`;
  ctx.lineWidth = 1;
  const cx = w / 2;
  const cy = horizonY();
  const t = performance.now();
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2 + (t * 0.0006);
    const len = 60 + 80 * intensity + (i % 3) * 30;
    const sx = cx + Math.cos(ang) * 100;
    const sy = cy + Math.sin(ang) * 60;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(ang) * len, sy + Math.sin(ang) * len);
    ctx.stroke();
  }
}

function drawSideHints(w, h) {
  const lane = tracker.getLane?.() ?? 0;
  if (lane === 0) return;
  ctx.save();
  if (lane === -1) {
    const g = ctx.createLinearGradient(0, 0, w * 0.25, 0);
    g.addColorStop(0, "rgba(74,216,255,0.35)");
    g.addColorStop(1, "rgba(74,216,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w * 0.25, h);
  } else {
    const g = ctx.createLinearGradient(w, 0, w * 0.75, 0);
    g.addColorStop(0, "rgba(74,216,255,0.35)");
    g.addColorStop(1, "rgba(74,216,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(w * 0.75, 0, w * 0.25, h);
  }
  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

// Idle render (start screen / menus animation).
(function idleRender() {
  if (!state.running) {
    state.scrollZ += 1.5;
    render();
  }
  requestAnimationFrame(idleRender);
})();
