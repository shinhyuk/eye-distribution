// Eye / gaze tracker using MediaPipe Tasks Vision (FaceLandmarker with iris).
// Exposes a singleton `tracker` on window that emits a smoothed horizontal
// gaze ratio in [0, 1] (0 = far left in user's view, 1 = far right).

import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

// MediaPipe Face Mesh canonical iris/eye landmark indices.
const LEFT_EYE_OUTER = 33;
const LEFT_EYE_INNER = 133;
const LEFT_IRIS = 468;

const RIGHT_EYE_INNER = 362;
const RIGHT_EYE_OUTER = 263;
const RIGHT_IRIS = 473;

// Vertical eyelid landmarks for "eye open" approximation.
const LEFT_LID_TOP = 159;
const LEFT_LID_BOT = 145;
const RIGHT_LID_TOP = 386;
const RIGHT_LID_BOT = 374;

class GazeTracker {
  constructor() {
    this.video = null;
    this.overlay = null;
    this.octx = null;
    this.faceLandmarker = null;
    this.running = false;
    this.lastVideoTime = -1;
    this.rawRatio = 0.5;
    this.smoothedRatio = 0.5;
    this.eyesOpen = true;
    this.faceVisible = false;
    // When user looks LEFT (their own left), the iris in the un-mirrored
    // camera image drifts toward the image's RIGHT, so the eye ratio is
    // HIGHER. So "left" anchor sits above center, "right" sits below.
    this.calibration = { left: 0.62, center: 0.5, right: 0.38 };
    this.listeners = new Set();
  }

  on(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  emit() {
    const lane = this.getLane();
    const norm = this.getNormalizedRatio();
    for (const cb of this.listeners) cb({ lane, norm, raw: this.smoothedRatio, eyesOpen: this.eyesOpen, faceVisible: this.faceVisible });
  }

  async start({ video, overlay }) {
    this.video = video;
    this.overlay = overlay;
    this.octx = overlay.getContext("2d");

    // 1. webcam
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false,
    });
    this.video.srcObject = stream;
    await new Promise((res) => {
      this.video.onloadedmetadata = () => {
        this.video.play();
        res();
      };
    });
    overlay.width = this.video.videoWidth;
    overlay.height = this.video.videoHeight;

    // 2. mediapipe
    const fileset = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    this.faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });

    this.running = true;
    this._loop();
  }

  _loop() {
    if (!this.running) return;
    const now = performance.now();
    if (this.video.currentTime !== this.lastVideoTime && this.video.readyState >= 2) {
      this.lastVideoTime = this.video.currentTime;
      try {
        const result = this.faceLandmarker.detectForVideo(this.video, now);
        this._processResult(result);
      } catch (e) {
        // detection can throw transiently while video resizes.
      }
    }
    requestAnimationFrame(() => this._loop());
  }

  _processResult(result) {
    const ctx = this.octx;
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);

    if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
      this.faceVisible = false;
      this.emit();
      return;
    }
    const lm = result.faceLandmarks[0];
    this.faceVisible = true;

    const leftRatio = this._eyeRatio(lm, LEFT_EYE_OUTER, LEFT_EYE_INNER, LEFT_IRIS);
    const rightRatio = this._eyeRatio(lm, RIGHT_EYE_INNER, RIGHT_EYE_OUTER, RIGHT_IRIS);
    // Average. Note: in a face-front view, both ratios should agree.
    const avg = (leftRatio + rightRatio) / 2;

    // open-ness ratio - distance between eyelids relative to eye width.
    const leftOpen = this._eyeOpenness(lm, LEFT_EYE_OUTER, LEFT_EYE_INNER, LEFT_LID_TOP, LEFT_LID_BOT);
    const rightOpen = this._eyeOpenness(lm, RIGHT_EYE_INNER, RIGHT_EYE_OUTER, RIGHT_LID_TOP, RIGHT_LID_BOT);
    this.eyesOpen = (leftOpen + rightOpen) / 2 > 0.18;

    this.rawRatio = avg;
    // Exponential smoothing.
    const alpha = 0.35;
    this.smoothedRatio = this.smoothedRatio * (1 - alpha) + avg * alpha;

    this._drawDebug(lm);
    this.emit();
  }

  _eyeRatio(lm, outerIdx, innerIdx, irisIdx) {
    const outer = lm[outerIdx];
    const inner = lm[innerIdx];
    const iris = lm[irisIdx];
    // Determine which side is left in image space; we want ratio along the eye's horizontal axis.
    const xMin = Math.min(outer.x, inner.x);
    const xMax = Math.max(outer.x, inner.x);
    if (xMax - xMin < 1e-6) return 0.5;
    return (iris.x - xMin) / (xMax - xMin);
  }

  _eyeOpenness(lm, outerIdx, innerIdx, topIdx, botIdx) {
    const outer = lm[outerIdx];
    const inner = lm[innerIdx];
    const top = lm[topIdx];
    const bot = lm[botIdx];
    const w = Math.hypot(outer.x - inner.x, outer.y - inner.y);
    if (w < 1e-6) return 0;
    const h = Math.hypot(top.x - bot.x, top.y - bot.y);
    return h / w;
  }

  _drawDebug(lm) {
    const ctx = this.octx;
    const w = this.overlay.width;
    const h = this.overlay.height;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(74, 216, 255, 0.9)";
    ctx.fillStyle = "rgba(255, 181, 71, 0.9)";

    const drawEye = (outerI, innerI, irisI) => {
      const outer = lm[outerI], inner = lm[innerI], iris = lm[irisI];
      ctx.beginPath();
      ctx.moveTo(outer.x * w, outer.y * h);
      ctx.lineTo(inner.x * w, inner.y * h);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(iris.x * w, iris.y * h, 4, 0, Math.PI * 2);
      ctx.fill();
    };
    drawEye(LEFT_EYE_OUTER, LEFT_EYE_INNER, LEFT_IRIS);
    drawEye(RIGHT_EYE_INNER, RIGHT_EYE_OUTER, RIGHT_IRIS);
  }

  // Map raw ratio into normalized -1..1 using calibration anchors.
  // In MediaPipe normalized image coords, x grows left->right of the *image*.
  // The webcam preview is mirrored visually, but the underlying frame is not.
  // When user looks to their LEFT, iris in the image moves to the image's RIGHT
  // (because user's left eye is on viewer's left side of image, and iris drifts
  // toward the inner corner which is on the right). Empirically:
  // - looking-left (user) -> ratio increases
  // - looking-right (user) -> ratio decreases
  // We express normalized as +1 = user looking right, -1 = user looking left.
  getNormalizedRatio() {
    const { left, center, right } = this.calibration;
    const r = this.smoothedRatio;
    const leftDir = Math.sign(left - center) || 1;
    const rightDir = Math.sign(right - center) || -1;
    const offset = r - center;
    if (offset * leftDir > 0) {
      const denom = Math.abs(left - center) || 1e-3;
      const t = Math.min(1, Math.abs(offset) / denom);
      return -t; // user looking left -> negative
    } else if (offset * rightDir > 0) {
      const denom = Math.abs(right - center) || 1e-3;
      const t = Math.min(1, Math.abs(offset) / denom);
      return +t; // user looking right -> positive
    }
    return 0;
  }

  getLane() {
    const n = this.getNormalizedRatio();
    const TH = 0.22;
    if (!this.faceVisible) return 0;
    if (n > TH) return 1;   // right
    if (n < -TH) return -1; // left
    return 0;
  }

  // Save current smoothed ratio as a calibration anchor.
  capture(anchor) {
    this.calibration[anchor] = this.smoothedRatio;
  }

  loadCalibration() {
    try {
      const raw = localStorage.getItem("eye-subway:calibration");
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (typeof data.left === "number" && typeof data.center === "number" && typeof data.right === "number") {
        this.calibration = data;
        return true;
      }
    } catch {}
    return false;
  }

  saveCalibration() {
    localStorage.setItem("eye-subway:calibration", JSON.stringify(this.calibration));
  }
}

const tracker = new GazeTracker();
window.tracker = tracker;
export default tracker;
