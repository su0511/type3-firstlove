/* hush — A1.svg background + Hush + LetterTrails (fade, full-cover svg) + SoftSymbols(top-fall)
   - 无鼠标跟随
   - 左上 & 右下区域的 trail 更稀疏
*/

let W, H;
let svgTex = null;
const WORD_HUSH = "hush";

const FONT_NAME     = "EB Garamond";   // 中间 hush & 顶部两角
const EDGE_FONT_EN  = "EB Garamond";   // 左上/右上
const EDGE_FONT_JP  = "Noto Serif JP"; // 左下/右下
let fontsReady = false;

/* ===== Palette ===== */
const COLOR_FLOAT  = [160, 200, 195];   // trail 基色（仍保留，不再直接用来上色）
const COLOR_HUSH   = [70, 130, 120];    // hush 颜色
const COLOR_EDGE   = [90, 140, 130];    // 边角文案颜色
const COLOR_SYMBOL = [40, 95, 88];      // 符号颜色（略深于 trail）

/* —— Trail 颜色分布：在深浅两种绿之间插值（偏向深色） —— */
const TRAIL_C1 = { r:130, g:175, b:170 }; // 深绿
const TRAIL_C2 = { r:180, g:220, b:215 }; // 浅绿
const DEEP_BIAS = 1.8;                    // 偏深力度：>1 越大越偏向深色 c1

// 透明度分布（双峰）：深的不透明多一些
const ALPHA_DEEP_RANGE  = [180, 235];   // 深色的 alpha 取值范围
const ALPHA_LIGHT_RANGE = [ 80, 150];   // 浅色的 alpha 取值范围
const ALPHA_DEEP_PROB   = 0.7;         // 有 70% 概率走“深色透明度段”

/* hush anchors */
const hushAnchors = [
  { u: 0.70, v: 0.80, sizeFactor: 0.16 },
  { u: 0.61, v: 0.38, sizeFactor: 0.085 },
  { u: 0.75, v: 0.20, sizeFactor: 0.08 }
];
let hushes = [];

const TRACKING_PX = { big: 10, mid: 9, small: 8 };

/* global motion */
const GLOBAL_SPEED_MULT = 0.9;
const GLOBAL_SIZE_PULSE = 0.9;

/* Edge titles */
const EDGE_TOP_TEXT    = "First Love";
const EDGE_RIGHT_TEXT  = "Hikaru Utada";
const EDGE_BOTTOM_TEXT = "宇多田ヒカル";
const EDGE_LEFT_TEXT   = "ファースト・ラブ";

let EDGE_MARGIN, EDGE_SIZE;
const EDGE_ALPHA_TOP    = 200;   // 顶部透明度
const EDGE_ALPHA_BOTTOM = 170;   // 底部透明度
const JP_SIZE_RATIO     = 0.85;  // 日文相对英文字号
const EDGE_WEIGHT       = 0.3;   // 文案粗细 (1=正常，>1更粗，<1更细)

/* ===== SoftSymbols（从顶部掉落）===== */
let symbols = [];
const SYMBOL_COUNT = 24;
const SYMBOL_SET   = ["—","·","□","◇","/","×"];
const SYMBOL_ALPHA = [50, 85];
const SYMBOL_BLUR  = [0.8, 1.6];
const SYMBOL_SIZE  = [12, 18];
const SYMBOL_SPEED = [0.018, 0.038];

/* ===== Letter Trails（轨迹层）===== */
let pg; // 前景缓冲（trail 专用）
const MESSAGE = "hush breathe soft ";
let writers = [];
const WRITER_COUNT = 60;
const WRITER_MAX   = 100;
const STEP = 0.85;
const GAP  = 17;
const NOISE_SCALE = 0.24;
const LETTER_MIN = 10, LETTER_MAX = 30;

/* —— 局部稀疏：左上 & 右下区域 —— */
const TL_REGION = {  // 左上区域
  x0: () => 0,
  x1: () => W * 0.42,
  y0: () => 0,
  y1: () => H * 0.38,
  skipProb: 0.60
};
const BR_REGION = {  // 右下区域
  x0: () => W * 0.58,
  x1: () => W,
  y0: () => H * 0.62,
  y1: () => H,
  skipProb: 0.60
};
function inRegion(x, y, R) {
  return x >= R.x0() && x <= R.x1() && y >= R.y0() && y <= R.y1();
}

function preload() {
  loadImage("A1.svg",
    img => { svgTex = img; },
    err => { svgTex = null; }
  );
}

function setup() {
  createOrResizeCanvas();
  frameRate(60);
  textFont(FONT_NAME);
  noStroke();

  regenerateHushes();
  regenerateSymbols();
  setupLetterTrailsLayer();

  noLoop();
  if (document?.fonts?.ready) {
    document.fonts.ready.then(() => { fontsReady = true; loop(); });
  } else { fontsReady = true; loop(); }
}

function windowResized() {
  createOrResizeCanvas();
  regenerateHushes();
  regenerateSymbols();
  resizeLetterTrailsLayer();
}

function createOrResizeCanvas() {
  W = windowWidth; H = windowHeight;
  if (!this._p5Created) { createCanvas(W, H); this._p5Created = true; }
  else { resizeCanvas(W, H); }

  const base = min(W, H);
  EDGE_SIZE   = constrain(round(base * 0.020), 10, 24); // 整体字号变小
  EDGE_MARGIN = constrain(round(base * 0.025), 15, 30); // 边距也相应缩小
}

/* ========== Generators ========== */

function regenerateHushes() {
  hushes = hushAnchors.map(a => new HushController({
    x: a.u * W,
    y: a.v * H,
    size: min(W, H) * a.sizeFactor,
    blur: 3.0,
    alphaMax: 165
  }));
}

function regenerateSymbols() {
  symbols = [];
  for (let i = 0; i < SYMBOL_COUNT; i++) symbols.push(new SoftSymbol(true));
}

/* ===== Letter Trails setup ===== */
function setupLetterTrailsLayer(){
  pg = createGraphics(W, H);
  pg.pixelDensity(2);
  pg.textAlign(CENTER, CENTER);
  pg.clear();
  pg.textFont("EB Garamond");

  writers = [];
  for (let i = 0; i < WRITER_COUNT; i++) writers.push(new Writer());
}

function resizeLetterTrailsLayer(){
  const ng = createGraphics(W, H);
  ng.pixelDensity(2);
  ng.textAlign(CENTER, CENTER);
  ng.textFont("EB Garamond");
  ng.image(pg, 0, 0, W, H);
  pg = ng;
}

/* ========== Draw Loop（层级：背景 → 符号 → 边角 → trail → hush/front） ========== */

function draw() {
  drawSvgTextureCover(100);

  for (let s of symbols) s.updateAndDraw();

  drawEdgeTexts();

  updateLetterTrails();
  image(pg, 0, 0);

  for (let h of hushes) h.updateAndDraw();
}

/* ========== Background (A1.svg cover) ========== */
function drawSvgTextureCover(alpha = 100) {
  clear();
  if (!svgTex) { background(234, 245, 242); return; }

  push();
  tint(255, alpha);
  const sw = svgTex.width, sh = svgTex.height;
  let scale = max(W / sw, H / sh) * 1.06; // overscan
  const w = Math.ceil(sw * scale) + 2;
  const h = Math.ceil(sh * scale) + 2;
  const x = Math.floor((W - w) / 2);
  const y = Math.floor((H - h) / 2);
  image(svgTex, x, y, w, h);
  pop();
}

/* ========== Edge Titles ========== */
function drawEdgeTexts(){
  if (!fontsReady) return;
  const m = EDGE_MARGIN;

  // 顶部（英文）
  push();
  textFont(EDGE_FONT_EN);
  textSize(EDGE_SIZE);
  stroke(COLOR_EDGE[0], COLOR_EDGE[1], COLOR_EDGE[2], EDGE_ALPHA_TOP);
  strokeWeight(EDGE_WEIGHT);
  fill(COLOR_EDGE[0], COLOR_EDGE[1], COLOR_EDGE[2], EDGE_ALPHA_TOP);
  textAlign(LEFT, TOP);
  text(EDGE_TOP_TEXT, m, m);
  textAlign(RIGHT, TOP);
  text(EDGE_RIGHT_TEXT, W - m, m);
  pop();

  // 底部（日文）
  push();
  textFont(EDGE_FONT_JP);
  textSize(EDGE_SIZE * JP_SIZE_RATIO);
  stroke(COLOR_EDGE[0], COLOR_EDGE[1], COLOR_EDGE[2], EDGE_ALPHA_BOTTOM);
  strokeWeight(EDGE_WEIGHT);
  fill(COLOR_EDGE[0], COLOR_EDGE[1], COLOR_EDGE[2], EDGE_ALPHA_BOTTOM);
  textAlign(LEFT, BOTTOM);
  text(EDGE_LEFT_TEXT, m, H - m);
  textAlign(RIGHT, BOTTOM);
  text(EDGE_BOTTOM_TEXT, W - m, H - m);
  pop();
}

/* ========== Classes ========== */

class HushController {
  constructor({x, y, size, blur, alphaMax}) {
    Object.assign(this, {x, y, size, blur});
    this.alphaMax = alphaMax;
    this.alphaMin = alphaMax * 0.40;
    this.alpha    = alphaMax;
    this.phase    = random(TAU);
    this.pulseSpd = 0.04 * GLOBAL_SPEED_MULT;
    this.sizeSpd  = 0.022 * GLOBAL_SIZE_PULSE;
    this.sizeAmp  = 0.10 * GLOBAL_SIZE_PULSE;
  }
  updateAndDraw() {
    const hoverR   = this.size * 0.58;
    const hovering = dist(mouseX, mouseY, this.x, this.y) <= hoverR;

    if (!hovering) {
      const s = 0.5 + 0.5 * sin(frameCount * this.pulseSpd + this.phase);
      this.alpha = lerp(this.alphaMin, this.alphaMax, s);
    }

    const dx = 1.6 * sin((frameCount + this.phase) * 0.016 * GLOBAL_SPEED_MULT);
    const dy = 1.2 * cos((frameCount + this.phase) * 0.014 * GLOBAL_SPEED_MULT);

    const sizePulse = hovering ? 1.0 : 1.0 + this.sizeAmp * sin(frameCount * this.sizeSpd + this.phase);
    const trackPx = (this.size > 0.14 * min(W,H)) ? TRACKING_PX.big
                   : (this.size > 0.09 * min(W,H)) ? TRACKING_PX.mid
                   : TRACKING_PX.small;

    push();
    translate(this.x + dx, this.y + dy);
    drawingContext.save();
    drawingContext.filter = `blur(${this.blur}px)`;
    fill(COLOR_HUSH[0], COLOR_HUSH[1], COLOR_HUSH[2], this.alpha);
    drawTrackedTextCentered(WORD_HUSH, this.size * sizePulse, trackPx);
    drawingContext.restore();
    pop();
  }
}

/* —— SoftSymbol：从顶部随机掉落 —— */
class SoftSymbol {
  constructor(init=false){ this.reset(init); }
  reset(init=false){
    this.x = random(W);
    this.y = init ? random(-H * 0.2, H) : random(-H * 0.25, -20);
    this.r = random(TAU);
    this.rs = random(-0.0015, 0.0015);
    this.k = random(SYMBOL_SET);
    this.sz = random(SYMBOL_SIZE[0], SYMBOL_SIZE[1]);
    this.sp = random(SYMBOL_SPEED[0], SYMBOL_SPEED[1]);
    this.al = random(SYMBOL_ALPHA[0], SYMBOL_ALPHA[1]);
    this.wobble = random(1000);
    this.blurPx = random(SYMBOL_BLUR[0], SYMBOL_BLUR[1]);
  }
  updateAndDraw(){
    this.y += this.sp * 24;
    this.x += sin(frameCount * 0.008 + this.wobble) * 0.35;
    this.r += this.rs;

    if (this.y > H + 30) this.reset(false);

    push();
    translate(this.x, this.y);
    rotate(this.r);
    drawingContext.save();
    drawingContext.filter = `blur(${this.blurPx}px)`;
    fill(COLOR_SYMBOL[0], COLOR_SYMBOL[1], COLOR_SYMBOL[2], this.al);
    textFont(EDGE_FONT_JP);
    textSize(this.sz);
    textAlign(CENTER, CENTER);
    text(this.k, 0, 0);
    drawingContext.restore();
    pop();
  }
}

/* ===== Letter Trails core（固定 ADD，带淡出，不压黑）===== */
class Writer {
  constructor() {
    this.pos = createVector(random(W), random(H));
    this.turn = random(1000);
    this.acc = 0;
    this.i = floor(random(MESSAGE.length));
    this.size = random(LETTER_MIN, LETTER_MAX);
    this.tilt = random(TAU);
    this.weight = random(0.7, 1.0);
  }
  stepAndStamp(g) {
    const n = noise(this.pos.x * NOISE_SCALE, this.pos.y * NOISE_SCALE, this.turn);
    const ang = TAU * n + 0.34 * sin((frameCount + this.turn * 300.0) * 0.01);
    const v = p5.Vector.fromAngle(ang).mult(STEP);
    this.pos.add(v);

    // 出界回卷
    if (this.pos.x < -10 || this.pos.x > W + 10 || this.pos.y < -10 || this.pos.y > H + 10) {
      this.pos.set(random(W), random(H));
      this.acc = 0;
    }

    // 到达间距就落一个字
    this.acc += STEP;
    if (this.acc >= GAP) {
      this.acc = 0;

      // —— 局部稀疏：左上 / 右下区域，有概率跳过 —— 
      let skip = false;
      if (inRegion(this.pos.x, this.pos.y, TL_REGION) && random() < TL_REGION.skipProb) skip = true;
      if (inRegion(this.pos.x, this.pos.y, BR_REGION) && random() < BR_REGION.skipProb) skip = true;
      if (skip) { this.i = (this.i + 1) % MESSAGE.length; return; }

      const ch = MESSAGE[this.i];
      const isSpace = (ch === " ");

      g.push();
      g.translate(this.pos.x, this.pos.y);
      g.rotate(ang + this.tilt * 0.05 + random(-0.08, 0.08));

      // —— 颜色：在深浅两种绿之间插值，偏向深色 —— 
      const t = pow(random(), DEEP_BIAS);  // 越大越偏深
      const r = TRAIL_C1.r + (TRAIL_C2.r - TRAIL_C1.r) * t;
      const gch = TRAIL_C1.g + (TRAIL_C2.g - TRAIL_C1.g) * t;
      const b = TRAIL_C1.b + (TRAIL_C2.b - TRAIL_C1.b) * t;

      // —— 透明度：70% 走更深的透明度段，30% 走更浅 —— 
      const aRange = (random() < ALPHA_DEEP_PROB) ? ALPHA_DEEP_RANGE : ALPHA_LIGHT_RANGE;
      const alpha = random(aRange[0], aRange[1]);

      g.fill(r, gch, b, alpha);
      g.noStroke();
      g.textSize(isSpace ? this.size * 0.5
                         : this.size * (0.9 + 0.2 * noise(frameCount * 0.05 + this.turn)));

      // 轻模糊
      g.drawingContext.save();
      g.drawingContext.filter = "blur(1.0px)";
      g.text(isSpace ? "·" : ch, 0, 0);
      g.drawingContext.restore();

      g.pop();

      this.i = (this.i + 1) % MESSAGE.length;
    }
  }
}

function updateLetterTrails(){
  // 逐步增加“打字员”
  if (frameCount % 12 === 0 && writers.length < WRITER_MAX) {
    for (let i = 0; i < 3; i++) writers.push(new Writer());
  }

  // 固定 ADD 模式绘制 trail
  pg.push();
  pg.blendMode(ADD);
  for (let w of writers) w.stepAndStamp(pg);
  pg.pop();

  // 淡出（不压黑）
  pg.push();
  pg.erase(3, 3);
  pg.rect(0, 0, pg.width, pg.height);
  pg.noErase();
  pg.pop();
}

/* ========== Text helper ========== */
function drawTrackedTextCentered(str, sizePx, trackPx) {
  push();
  textSize(sizePx);
  textAlign(LEFT, BASELINE);

  let lettersW = 0;
  for (let i = 0; i < str.length; i++) lettersW += textWidth(str[i]);

  const gaps = max(0, str.length - 1);
  const maxLineW = W * 0.8;
  const maxTrackPx = gaps > 0 ? max(0, (maxLineW - lettersW) / gaps) : 0;

  const tpx = min(trackPx, maxLineW > 0 ? maxTrackPx : trackPx);
  const totalW = lettersW + tpx * gaps;

  let x = -totalW / 2;
  let y = sizePx * 0.35;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    text(ch, x, y);
    x += textWidth(ch) + tpx;
  }
  pop();
}
