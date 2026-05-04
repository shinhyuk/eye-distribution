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

// Has the user successfully calibrated this session? (Loaded values count.)
let calibrationDone = false;

function refreshStartGate() {
  els.btnStart.disabled = !calibrationDone;
}

async function ensureTracker() {
  if (trackerReady) return true;
  if (trackerStarting) return trackerStarting;
  trackerStarting = (async () => {
    try {
      els.status.textContent = "웹캠 권한을 허용해 주세요...";
      await tracker.start({ video: els.webcam, overlay: els.overlay });
      const hadCal = tracker.loadCalibration();
      if (hadCal) {
        calibrationDone = true;
        els.status.textContent = "이전 보정값을 불러왔어요. 바로 시작하거나 재보정하세요.";
      } else {
        els.status.textContent = "‘보정 시작’을 먼저 진행해 주세요.";
      }
      refreshStartGate();
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

els.status.textContent = "‘보정 시작’을 먼저 누르면 카메라 권한이 요청됩니다.";
els.btnStart.disabled = true;
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
    calibrationDone = true;
    refreshStartGate();
    els.status.textContent = "보정 완료! 이제 게임을 시작할 수 있어요.";
  } else {
    updateCalUI();
  }
});

// ----- Start / restart -----
els.btnStart.addEventListener("click", async () => {
  try { await ensureTracker(); } catch { return; }
  if (!calibrationDone) {
    els.status.textContent = "먼저 ‘보정 시작’을 진행해 주세요.";
    openCalibration();
    return;
  }
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
const HOLD_TO_SWITCH_MS = 25;
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

  state.laneTransition = Math.min(1, state.laneTransition + dt / 130);

  // Easy ramp: gentle baseline, soft top.
  state.speed = 1.0 + Math.min(1.4, state.score / 1400);
  els.speed.textContent = state.speed.toFixed(1) + "x";

  const baseScroll = 0.4;
  const scrollDelta = baseScroll * state.speed * dt;
  state.scrollZ += scrollDelta;
  state.score += scrollDelta * 0.05;
  els.score.textContent = Math.floor(state.score);

  for (const o of state.obstacles) o.z -= scrollDelta;
  for (const c of state.coins) c.z -= scrollDelta;

  // Spawn obstacles less frequently for easier flow.
  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    spawnObstacle();
    state.spawnTimer = 1300 / state.speed;
  }
  state.coinTimer -= dt;
  if (state.coinTimer <= 0) {
    spawnCoinTrail();
    state.coinTimer = 1500 / state.speed;
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
  // 65% chance to keep the same lane as the most recent obstacle so the
  // player can rest in the free lane instead of switching every spawn.
  let lane = Math.random() < 0.5 ? 0 : 1;
  const last = state.obstacles[state.obstacles.length - 1];
  if (last && Math.random() < 0.65) lane = last.lane;
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
  sky.addColorStop(0, "#080522");
  sky.addColorStop(0.55, "#1a0d4a");
  sky.addColorStop(1, "#5b1a78");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, hor);

  // distant horizon glow band
  const haze = ctx.createLinearGradient(0, hor - 80, 0, hor + 8);
  haze.addColorStop(0, "rgba(255, 60, 200, 0)");
  haze.addColorStop(0.65, "rgba(255, 60, 200, 0.35)");
  haze.addColorStop(1, "rgba(0, 240, 255, 0.55)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, hor - 80, w, 88);

  // stars
  if (!drawSky.cache) {
    drawSky.cache = Array.from({ length: 70 }, () => ({
      x: Math.random(), y: Math.random() * 0.6, r: Math.random() * 1.2 + 0.25,
      tw: Math.random() * Math.PI * 2,
    }));
  }
  const t = performance.now() / 900;
  for (const s of drawSky.cache) {
    const a = 0.4 + 0.45 * Math.abs(Math.sin(s.tw + t * (0.7 + s.r)));
    ctx.fillStyle = `rgba(220, 235, 255, ${a})`;
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * hor, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGround(w, h) {
  const hor = horizonY();
  const grad = ctx.createLinearGradient(0, hor, 0, h);
  grad.addColorStop(0, "#0a0e26");
  grad.addColorStop(0.6, "#06081a");
  grad.addColorStop(1, "#02030a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, hor, w, h - hor);

  // perspective grid (horizontal + vertical) on ground.
  ctx.strokeStyle = "rgba(0, 240, 255, 0.07)";
  ctx.lineWidth = 1;
  const offset = state.scrollZ % ROAD_SEGMENT;
  for (let i = 0; i < 28; i++) {
    const z = i * ROAD_SEGMENT - offset;
    if (z < -5) continue;
    const y = projY(z);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // radial vertical lines (from vanishing point).
  const cx = w / 2;
  for (let i = -8; i <= 8; i++) {
    if (i === 0) continue;
    const x0 = cx;
    const x1 = cx + i * (w * 0.12);
    ctx.beginPath();
    ctx.moveTo(x0, hor);
    ctx.lineTo(x1, h);
    ctx.stroke();
  }
}

function drawRoad(w, h) {
  const hor = horizonY();
  const cx = w / 2;

  const farTopY = hor;
  const farTopHalf = 1;
  const groundHalf = TRACK_HALF_W;
  const bottomY = h;
  const bottomHalf = TRACK_HALF_W * (bottomY - hor) / Math.max(1, groundY() - hor);

  // Asphalt — dark with subtle inner gradient (cooler near horizon).
  const asphalt = ctx.createLinearGradient(0, hor, 0, h);
  asphalt.addColorStop(0, "#0c1126");
  asphalt.addColorStop(0.5, "#0a0d20");
  asphalt.addColorStop(1, "#080a18");
  ctx.fillStyle = asphalt;
  ctx.beginPath();
  ctx.moveTo(cx - farTopHalf, farTopY);
  ctx.lineTo(cx + farTopHalf, farTopY);
  ctx.lineTo(cx + bottomHalf, bottomY);
  ctx.lineTo(cx - bottomHalf, bottomY);
  ctx.closePath();
  ctx.fill();

  // Subtle inner sheen near top of road.
  const sheen = ctx.createLinearGradient(0, hor, 0, hor + 80);
  sheen.addColorStop(0, "rgba(0, 240, 255, 0.12)");
  sheen.addColorStop(1, "rgba(0, 240, 255, 0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(cx - groundHalf, hor, groundHalf * 2, 90);

  // Edge light strips — single soft cyan glow on each shoulder.
  drawEdgeGlow(cx, hor, groundHalf, bottomHalf, bottomY);

  // Center divider: a single continuous neon line with brightness pulse along its length.
  drawCenterRail(cx, hor);

  // Horizon kiss — thin bright line where road meets sky.
  ctx.fillStyle = "rgba(180, 240, 255, 0.85)";
  ctx.fillRect(cx - 1, hor - 0.5, 2, 1);
  const horizonGlow = ctx.createLinearGradient(0, hor - 6, 0, hor + 6);
  horizonGlow.addColorStop(0, "rgba(0, 240, 255, 0)");
  horizonGlow.addColorStop(0.5, "rgba(0, 240, 255, 0.5)");
  horizonGlow.addColorStop(1, "rgba(0, 240, 255, 0)");
  ctx.fillStyle = horizonGlow;
  ctx.fillRect(cx - 60, hor - 6, 120, 12);
}

function drawEdgeGlow(cx, hor, groundHalf, bottomHalf, bottomY) {
  // Bright cyan rail line then soft outer halo on each side.
  for (const side of [-1, 1]) {
    // halo (drawn as thick semi-transparent line w/ many parallel offsets approximated by gradient strip).
    const grad = ctx.createLinearGradient(cx + side * (groundHalf - 12), 0, cx + side * (groundHalf + 12), 0);
    grad.addColorStop(0, "rgba(0, 240, 255, 0)");
    grad.addColorStop(0.5, "rgba(0, 240, 255, 0.35)");
    grad.addColorStop(1, "rgba(0, 240, 255, 0)");
    ctx.fillStyle = grad;
    // approximate a perspective strip by polygon
    const fNear = 14;
    const fFar = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx + side * (0 - fFar), hor);
    ctx.lineTo(cx + side * (0 + fFar), hor);
    ctx.lineTo(cx + side * (bottomHalf + fNear), bottomY);
    ctx.lineTo(cx + side * (bottomHalf - fNear), bottomY);
    ctx.closePath();
    ctx.fill();

    // crisp inner line
    ctx.strokeStyle = "rgba(180, 240, 255, 0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + side * 0, hor);
    ctx.lineTo(cx + side * bottomHalf, bottomY);
    ctx.stroke();
  }
}

function drawCenterRail(cx, hor) {
  // Build dashed segments along z, in cyan with a moving bright pulse.
  const segOffset = state.scrollZ % ROAD_SEGMENT;
  const segCount = 28;
  const t = performance.now() / 600;

  for (let i = 0; i < segCount; i++) {
    const zNear = i * ROAD_SEGMENT - segOffset;
    const zFar = zNear + ROAD_SEGMENT * 0.55; // dash:gap ≈ 55:45
    if (zFar < -5) continue;

    const sNear = projScale(Math.max(0, zNear));
    const sFar = projScale(Math.max(0, zFar));
    const yNear = projY(Math.max(0, zNear));
    const yFar = projY(Math.max(0, zFar));
    if (yFar > yNear - 0.5) continue;

    const wNear = 5 * sNear;
    const wFar = 5 * sFar;

    // moving brightness pulse — closer dashes brighter, with a phase shift.
    const phase = (i / segCount + t) % 1;
    const pulse = 0.55 + 0.45 * Math.max(0, Math.cos((phase - 0.2) * Math.PI * 2));
    ctx.fillStyle = `rgba(0, 240, 255, ${0.55 + 0.4 * pulse * sNear})`;
    ctx.beginPath();
    ctx.moveTo(cx - wFar / 2, yFar);
    ctx.lineTo(cx + wFar / 2, yFar);
    ctx.lineTo(cx + wNear / 2, yNear);
    ctx.lineTo(cx - wNear / 2, yNear);
    ctx.closePath();
    ctx.fill();
  }
}

function drawScenery(w, h) {
  // Floating neon pylons alongside the track for speed perception.
  const segOffset = state.scrollZ % (ROAD_SEGMENT * 2);
  for (let i = 0; i < 16; i++) {
    const z = i * ROAD_SEGMENT * 2 - segOffset;
    if (z < 0 || z > 1900) continue;
    const s = projScale(z);
    const y = projY(z);
    const halfW = (TRACK_HALF_W + 24) * s;
    const cx = canvasW() / 2;
    const colorTop = i % 2 === 0 ? "rgba(0, 240, 255," : "rgba(255, 60, 200,";
    const tipColor = i % 2 === 0 ? "#a8f4ff" : "#ffb6e8";

    const poleH = 38 * s;
    const poleW = Math.max(1, 2.4 * s);
    // pole gradient
    const grad = ctx.createLinearGradient(0, y - poleH, 0, y);
    grad.addColorStop(0, colorTop + "0.85)");
    grad.addColorStop(1, colorTop + "0.05)");
    ctx.fillStyle = grad;
    ctx.fillRect(cx - halfW - poleW / 2, y - poleH, poleW, poleH);
    ctx.fillRect(cx + halfW - poleW / 2, y - poleH, poleW, poleH);

    const tip = Math.max(1.2, 4 * s);
    ctx.fillStyle = tipColor;
    ctx.shadowColor = tipColor;
    ctx.shadowBlur = 8 * s;
    ctx.beginPath();
    ctx.arc(cx - halfW, y - poleH, tip, 0, Math.PI * 2);
    ctx.arc(cx + halfW, y - poleH, tip, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function drawObstacle(o) {
  if (o.z > SPAWN_Z + 10 || o.z < -120) return;
  const s = projScale(Math.max(0, o.z));
  const x = projX(LANE_OFFSETS[o.lane], Math.max(0, o.z));
  const y = projY(Math.max(0, o.z));
  const t = performance.now() / 1000;

  ctx.save();
  ctx.translate(x, y);

  // ground shadow with slight glow
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.ellipse(0, 8 * s, 42 * s, 9 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  if (o.kind === "barrier") {
    // Hover hex barrier — magenta neon edges, dark core, pulsing.
    const wd = 96 * s, hd = 34 * s;
    const pulse = 0.7 + 0.3 * Math.sin(t * 3 + o.z * 0.01);

    // soft glow halo
    ctx.fillStyle = `rgba(255, 60, 200, ${0.35 * pulse})`;
    ctx.beginPath();
    ctx.ellipse(0, -hd / 2, wd / 1.6, hd / 1.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // body (hex prism front face)
    const bodyGrad = ctx.createLinearGradient(0, -hd, 0, 0);
    bodyGrad.addColorStop(0, "#1a0820");
    bodyGrad.addColorStop(1, "#321538");
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.moveTo(-wd / 2 + 8 * s, -hd);
    ctx.lineTo(wd / 2 - 8 * s, -hd);
    ctx.lineTo(wd / 2, -hd / 2);
    ctx.lineTo(wd / 2 - 8 * s, 0);
    ctx.lineTo(-wd / 2 + 8 * s, 0);
    ctx.lineTo(-wd / 2, -hd / 2);
    ctx.closePath();
    ctx.fill();

    // neon edge
    ctx.strokeStyle = `rgba(255, 80, 220, ${0.85 * pulse})`;
    ctx.shadowColor = "#ff3cb6";
    ctx.shadowBlur = 10 * s;
    ctx.lineWidth = 2 * s;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // warning chevron in the middle
    ctx.fillStyle = `rgba(255, 230, 250, ${0.85 * pulse})`;
    ctx.beginPath();
    ctx.moveTo(-10 * s, -hd / 2 - 4 * s);
    ctx.lineTo(0, -hd / 2 + 2 * s);
    ctx.lineTo(10 * s, -hd / 2 - 4 * s);
    ctx.lineTo(6 * s, -hd / 2 - 4 * s);
    ctx.lineTo(0, -hd / 2 - 1 * s);
    ctx.lineTo(-6 * s, -hd / 2 - 4 * s);
    ctx.closePath();
    ctx.fill();
  } else {
    // Floating cyan crystal — diamond-prism with rim glow.
    const sz = 56 * s;
    const pulse = 0.65 + 0.35 * Math.sin(t * 2.5 + o.z * 0.008);
    const cy = -sz - 6 * s + Math.sin(t * 3 + o.z * 0.02) * 3 * s;

    // halo
    ctx.fillStyle = `rgba(0, 240, 255, ${0.3 * pulse})`;
    ctx.beginPath();
    ctx.ellipse(0, cy + sz / 2, sz * 0.85, sz * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // crystal body
    const cGrad = ctx.createLinearGradient(0, cy, 0, cy + sz);
    cGrad.addColorStop(0, "#a8f4ff");
    cGrad.addColorStop(0.4, "#3ed0ff");
    cGrad.addColorStop(1, "#0c4a8a");
    ctx.fillStyle = cGrad;
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(sz / 2, cy + sz / 2);
    ctx.lineTo(0, cy + sz);
    ctx.lineTo(-sz / 2, cy + sz / 2);
    ctx.closePath();
    ctx.fill();

    // facet highlight
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.beginPath();
    ctx.moveTo(0, cy + 3 * s);
    ctx.lineTo(sz / 4, cy + sz / 2);
    ctx.lineTo(0, cy + sz - 3 * s);
    ctx.lineTo(-2 * s, cy + sz / 2);
    ctx.closePath();
    ctx.fill();

    // rim
    ctx.strokeStyle = "rgba(0, 240, 255, 0.8)";
    ctx.shadowColor = "#00f0ff";
    ctx.shadowBlur = 12 * s;
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(sz / 2, cy + sz / 2);
    ctx.lineTo(0, cy + sz);
    ctx.lineTo(-sz / 2, cy + sz / 2);
    ctx.closePath();
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

function drawCoin(c) {
  const s = projScale(Math.max(0, c.z));
  const x = projX(LANE_OFFSETS[c.lane], Math.max(0, c.z));
  const y = projY(Math.max(0, c.z)) - 24 * s;
  const t = performance.now() / 1000;
  const pulse = 0.7 + 0.3 * Math.sin(t * 4 + c.z * 0.03);
  const r = 13 * s;

  ctx.save();
  ctx.translate(x, y);

  // outer halo
  ctx.fillStyle = `rgba(0, 240, 255, ${0.18 * pulse})`;
  ctx.beginPath();
  ctx.arc(0, 0, r * 2.6, 0, Math.PI * 2);
  ctx.fill();

  // mid halo
  ctx.fillStyle = `rgba(0, 240, 255, ${0.45 * pulse})`;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2);
  ctx.fill();

  // core orb with gradient
  const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.5, "#a8f4ff");
  grad.addColorStop(1, "#0aa5d4");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  // glint
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(-r * 0.35, -r * 0.35, r * 0.22, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawKart(w, h) {
  const wx = currentPlayerWorldX();
  const cx = projX(wx, 0);
  const cy = projY(0);

  const dirSign = state.laneTargetIndex - state.laneIndex; // -1, 0, +1
  const tilt = dirSign * (1 - state.laneTransition) * 0.16;
  const bob = Math.sin(performance.now() / 130) * 1.5;
  const hoverY = -2 + Math.sin(performance.now() / 280) * 1.2;
  const t = performance.now() / 1000;

  ctx.save();
  ctx.translate(cx, cy + bob);

  // hover air-cushion glow under the kart (drawn before body, on the ground).
  const cushion = ctx.createRadialGradient(0, 24, 4, 0, 24, 70);
  cushion.addColorStop(0, "rgba(0, 240, 255, 0.65)");
  cushion.addColorStop(0.6, "rgba(0, 240, 255, 0.2)");
  cushion.addColorStop(1, "rgba(0, 240, 255, 0)");
  ctx.fillStyle = cushion;
  ctx.beginPath();
  ctx.ellipse(0, 26, 64, 16, 0, 0, Math.PI * 2);
  ctx.fill();

  // soft pink shadow accent
  ctx.fillStyle = "rgba(255, 60, 200, 0.18)";
  ctx.beginPath();
  ctx.ellipse(0, 28, 70, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(0, hoverY);
  ctx.rotate(tilt);

  // ----- Lower chassis (dark plate visible from behind, slight tapering) -----
  ctx.fillStyle = "#0a0d1a";
  ctx.beginPath();
  ctx.moveTo(-48, 24);
  ctx.lineTo(48, 24);
  ctx.lineTo(38, 8);
  ctx.lineTo(-38, 8);
  ctx.closePath();
  ctx.fill();

  // side fins (thin angled slats)
  ctx.fillStyle = "#1a2348";
  ctx.beginPath();
  ctx.moveTo(-50, 22); ctx.lineTo(-38, 4); ctx.lineTo(-30, 6); ctx.lineTo(-44, 24);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(50, 22); ctx.lineTo(38, 4); ctx.lineTo(30, 6); ctx.lineTo(44, 24);
  ctx.closePath();
  ctx.fill();

  // ----- Main body (white pearl with cyan/magenta accent) -----
  const bodyGrad = ctx.createLinearGradient(0, -34, 0, 12);
  bodyGrad.addColorStop(0, "#f4f7ff");
  bodyGrad.addColorStop(0.55, "#cfd6ee");
  bodyGrad.addColorStop(1, "#5b6796");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(-40, 10);
  ctx.lineTo(40, 10);
  ctx.lineTo(32, -26);
  ctx.lineTo(20, -34);
  ctx.lineTo(-20, -34);
  ctx.lineTo(-32, -26);
  ctx.closePath();
  ctx.fill();

  // accent stripe along center, glowing cyan
  const stripe = ctx.createLinearGradient(0, -34, 0, 10);
  stripe.addColorStop(0, "rgba(0, 240, 255, 0.85)");
  stripe.addColorStop(1, "rgba(0, 240, 255, 0.0)");
  ctx.fillStyle = stripe;
  ctx.beginPath();
  ctx.moveTo(-4, -34);
  ctx.lineTo(4, -34);
  ctx.lineTo(3, 10);
  ctx.lineTo(-3, 10);
  ctx.closePath();
  ctx.fill();

  // body outline (subtle dark)
  ctx.strokeStyle = "rgba(10, 14, 30, 0.55)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-40, 10);
  ctx.lineTo(-32, -26);
  ctx.lineTo(-20, -34);
  ctx.lineTo(20, -34);
  ctx.lineTo(32, -26);
  ctx.lineTo(40, 10);
  ctx.stroke();

  // top highlight
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-18, -32);
  ctx.lineTo(18, -32);
  ctx.stroke();

  // ----- Cockpit canopy (smoked glass with cyan reflection) -----
  const canopy = ctx.createLinearGradient(0, -30, 0, -6);
  canopy.addColorStop(0, "rgba(8, 16, 36, 0.85)");
  canopy.addColorStop(1, "rgba(20, 36, 64, 0.65)");
  ctx.fillStyle = canopy;
  ctx.beginPath();
  ctx.moveTo(-22, -8);
  ctx.lineTo(22, -8);
  ctx.lineTo(16, -30);
  ctx.lineTo(-16, -30);
  ctx.closePath();
  ctx.fill();

  // canopy reflection sheen
  ctx.fillStyle = "rgba(0, 240, 255, 0.35)";
  ctx.beginPath();
  ctx.moveTo(-18, -28);
  ctx.lineTo(0, -28);
  ctx.lineTo(-4, -10);
  ctx.lineTo(-20, -10);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.moveTo(8, -28);
  ctx.lineTo(14, -28);
  ctx.lineTo(10, -12);
  ctx.lineTo(4, -12);
  ctx.closePath();
  ctx.fill();

  // ----- Driver helmet showing through canopy -----
  ctx.fillStyle = "#0f1730";
  ctx.beginPath();
  ctx.arc(0, -20, 11, Math.PI, 2 * Math.PI);
  ctx.fill();
  // visor
  ctx.fillStyle = "rgba(0, 240, 255, 0.85)";
  ctx.beginPath();
  ctx.arc(0, -20, 9, Math.PI * 1.1, Math.PI * 1.9);
  ctx.fill();

  // ----- Rear bumper / lights -----
  ctx.fillStyle = "#06080f";
  roundRect(-44, 8, 88, 8, 3);
  ctx.fill();

  // tail light strip (magenta + cyan)
  const tail = ctx.createLinearGradient(-44, 12, 44, 12);
  tail.addColorStop(0, "rgba(0, 240, 255, 0.95)");
  tail.addColorStop(0.5, "rgba(255, 60, 200, 0.95)");
  tail.addColorStop(1, "rgba(0, 240, 255, 0.95)");
  ctx.fillStyle = tail;
  roundRect(-40, 11, 80, 2.5, 1);
  ctx.fill();

  // ----- Thruster outlets (twin) -----
  for (const sx of [-22, 22]) {
    ctx.fillStyle = "#06080f";
    ctx.beginPath();
    ctx.ellipse(sx, 18, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // inner glow (varies with speed)
    const boost = Math.min(1, (state.speed - 1) / 2);
    const flick = 0.7 + 0.3 * Math.sin(t * 22 + sx);
    ctx.fillStyle = `rgba(255, 60, 200, ${0.7 + 0.25 * boost})`;
    ctx.beginPath();
    ctx.ellipse(sx, 18, 5 * flick, 3 * flick, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255, 230, 250, ${0.85})`;
    ctx.beginPath();
    ctx.ellipse(sx, 18, 2.5, 1.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // exhaust plume
    if (boost > 0.05 || true) {
      const len = 14 + boost * 22;
      const plume = ctx.createLinearGradient(sx, 22, sx, 22 + len);
      plume.addColorStop(0, "rgba(255, 60, 200, 0.7)");
      plume.addColorStop(0.6, "rgba(0, 240, 255, 0.35)");
      plume.addColorStop(1, "rgba(0, 240, 255, 0)");
      ctx.fillStyle = plume;
      ctx.beginPath();
      ctx.ellipse(sx, 22 + len / 2, 4, len / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
  drawSpeedLines(w, h);
}

function drawSpeedLines(w, h) {
  const intensity = Math.min(1, (state.speed - 1) / 2);
  if (intensity < 0.05) return;
  const cx = w / 2;
  const cy = horizonY() + 10;
  const t = performance.now();
  for (let i = 0; i < 14; i++) {
    const ang = (i / 14) * Math.PI * 2 + (t * 0.0004 + i * 0.13);
    const r0 = 90 + (i % 4) * 20;
    const len = 50 + 110 * intensity + (i % 3) * 28;
    const sx = cx + Math.cos(ang) * r0;
    const sy = cy + Math.sin(ang) * (r0 * 0.55);
    const ex = sx + Math.cos(ang) * len;
    const ey = sy + Math.sin(ang) * len * 0.65;
    const grad = ctx.createLinearGradient(sx, sy, ex, ey);
    grad.addColorStop(0, `rgba(255,255,255,${0.22 * intensity})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
}

function drawSideHints(w, h) {
  const lane = tracker.getLane?.() ?? 0;
  if (lane === 0) return;
  ctx.save();
  if (lane === -1) {
    const g = ctx.createLinearGradient(0, 0, w * 0.28, 0);
    g.addColorStop(0, "rgba(0, 240, 255, 0.38)");
    g.addColorStop(1, "rgba(0, 240, 255, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w * 0.28, h);
    // arrow
    ctx.fillStyle = "rgba(0, 240, 255, 0.7)";
    ctx.beginPath();
    ctx.moveTo(20, h / 2);
    ctx.lineTo(46, h / 2 - 18);
    ctx.lineTo(46, h / 2 + 18);
    ctx.closePath();
    ctx.fill();
  } else {
    const g = ctx.createLinearGradient(w, 0, w * 0.72, 0);
    g.addColorStop(0, "rgba(255, 60, 200, 0.38)");
    g.addColorStop(1, "rgba(255, 60, 200, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(w * 0.72, 0, w * 0.28, h);
    ctx.fillStyle = "rgba(255, 60, 200, 0.7)";
    ctx.beginPath();
    ctx.moveTo(w - 20, h / 2);
    ctx.lineTo(w - 46, h / 2 - 18);
    ctx.lineTo(w - 46, h / 2 + 18);
    ctx.closePath();
    ctx.fill();
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
