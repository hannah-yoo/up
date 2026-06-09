/**
 * paper.js — Rice Paper Cloth Simulation & Stacking Karma Sticker Game
 *
 * Layers:
 *   SVG layer 1:    '業' title — solid black, transitions to 3D engraved inner shadow on game start.
 *   Assets layer 2: decorative assets (flowers, paper strips) — always visible.
 *   Canvas layer 3: Jibang cloth columns — burn away on click; then becomes the stacking surface.
 */

'use strict';

// ─────────────────────────────────────────────
//  Canvas setup — fixed 1512×982 design space
// ─────────────────────────────────────────────
const paperCanvas = document.getElementById('paperCanvas');
const ctx         = paperCanvas.getContext('2d', { willReadFrequently: true });

const W = 1512;
const H = 982;

paperCanvas.width  = W;
paperCanvas.height = H;

function resize() {
  const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
  document.documentElement.style.setProperty('--scale', scale);
}
window.addEventListener('resize', resize);
resize();

// ─────────────────────────────────────────────
//  Game state variables
// ─────────────────────────────────────────────
let gameStarted       = false;
let isCollapsing      = false;
let gameOverShown     = false;
let collapseTimer     = 0;
let stickers          = [];
let activeDragSticker = null;

// ─────────────────────────────────────────────
//  Preloaded Sticker Images
// ─────────────────────────────────────────────
const stickerImages = {
  strip1: new Image(),
  red: new Image(),
  yellow: new Image(),
  blue: new Image(),
  strip2: new Image()
};
stickerImages.strip1.src = 'assets/paper strip 1.webp';
stickerImages.red.src    = 'assets/flower_red.webp';
stickerImages.yellow.src = 'assets/flower_yellow.webp';
stickerImages.blue.src   = 'assets/flower_blue.webp';
stickerImages.strip2.src = 'assets/paper strip 2.webp';

const stickerBaseWidths = {
  strip1: 277,
  red: 251,
  yellow: 230,
  blue: 302,
  strip2: 382
};

// ─────────────────────────────────────────────
//  Character Mask for Snapping
// ─────────────────────────────────────────────
let maskPoints = [];

function buildMaskPoints() {
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = W;
  maskCanvas.height = H;
  const mctx = maskCanvas.getContext('2d');

  mctx.fillStyle = '#000000';
  mctx.font = "700px 'Dela Gothic One'";
  mctx.textAlign = 'center';
  mctx.textBaseline = 'alphabetic';

  // Render '業' at exactly the same absolute position as the SVG title
  // SVG box: left=406, top=-108, text-anchor=middle at x=350, y=650.
  // Absolute X = 406 + 350 = 756
  // Absolute Y = -108 + 650 = 542
  mctx.fillText('業', 756, 542);

  maskPoints = [];
  const imgData = mctx.getImageData(0, 0, W, H);
  const data = imgData.data;
  const step = 4; // Check every 4th pixel for speed and precision

  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const idx = (y * W + x) * 4;
      if (data[idx + 3] > 100) { // Solid stroke pixel
        maskPoints.push({ x, y });
      }
    }
  }
}

// ─────────────────────────────────────────────
//  Noise helper (mulberry32)
// ─────────────────────────────────────────────
function mulberry32(seed) {
  return function () {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─────────────────────────────────────────────
//  Text texture content
// ─────────────────────────────────────────────
const TEXT_LEFT = `한국의 오래된 괴담처럼 전해지는 고려장 설화에서는 집안에서 부양하기 힘든 어른을 지게에 태워 산속으로 보내 버렸다고 한다. 지금으로서는 듣기만 해도 천인공노할 일이지만 만약 그 어른들이 처단당해 마땅할 업보를 쌓았다고 상상해 보면 이야기는 조금 달라질 수도 있다. 살아생전에 나쁜 업을 그득그득 쌓았더라도 어른은 어른이라고 정성스레 지게에 태워 고즈넉한 산속까지 모셨다고 생각해 보면 고려장 지게는 마지막 가시는 길에 효를 다하는 꽃상여 같다는 생각도 든다.`;

const TEXT_RIGHT = `이승을 떠난 사후세계에서부터는 진정한 업보의 되갚음이 시작될지도 모른다. 망자가 살아생전 타고 온 지게에 염라대왕이 지난 업보의 무게를 그득그득 쌓아놓고서는 업고 가라 명할 수도 있고, 황천길을 건너는 도중에는 갈 곳 없는 영혼들이 지게에 들러붙어 영영 놓아주지 않을 수도 있다. 이처럼 업업 에서는 한국의 장례와 사후세계에 관련된 시각적 요소들을 차용해 업을 쌓은 이가 업고 가는 무언가를 관객들과 상상해 보고자 한다. 이제 지방 종이는 클릭해서 태워버리고, 상여 장식들로 業을 쌓아보자.`;

// Korean word-break: keep-all rule (breaks at spaces first, fallback to character if single word is too long)
function drawParagraph(octx, text, x, y, maxWidth, lineHeight) {
  const paragraphs = text.split('\n');
  let curY = y;

  for (const paragraph of paragraphs) {
    const words = paragraph.split(' ');
    let line = '';

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const testLine = line ? (line + ' ' + word) : word;
      const metrics = octx.measureText(testLine);

      if (metrics.width > maxWidth) {
        if (line) {
          octx.fillText(line, x, curY);
          curY += lineHeight;
          line = word;
        } else {
          // Word itself is wider than maxWidth; split character-by-character
          let charLine = '';
          for (let j = 0; j < word.length; j++) {
            const testCharLine = charLine + word[j];
            if (octx.measureText(testCharLine).width > maxWidth && charLine.length > 0) {
              octx.fillText(charLine, x, curY);
              curY += lineHeight;
              charLine = word[j];
            } else {
              charLine = testCharLine;
            }
          }
          line = charLine;
        }
      } else {
        line = testLine;
      }
    }
    if (line) {
      octx.fillText(line, x, curY);
      curY += lineHeight;
    }
  }
  return curY;
}

function measureTextHeight(text, colW) {
  const oc = document.createElement('canvas');
  const octx = oc.getContext('2d');
  const px = 30, fontSize = 16, lineH = 25.6;
  octx.font = `400 ${fontSize}px 'Noto Sans KR', sans-serif`;
  const maxW = colW - px * 2;
  
  const paragraphs = text.split('\n');
  let totalLines = 0;

  for (const paragraph of paragraphs) {
    const words = paragraph.split(' ');
    let line = '';

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const testLine = line ? (line + ' ' + word) : word;
      const metrics = octx.measureText(testLine);

      if (metrics.width > maxW) {
        if (line) {
          totalLines++;
          line = word;
        } else {
          let charLine = '';
          for (let j = 0; j < word.length; j++) {
            const testCharLine = charLine + word[j];
            if (octx.measureText(testCharLine).width > maxW && charLine.length > 0) {
              totalLines++;
              charLine = word[j];
            } else {
              charLine = testCharLine;
            }
          }
          line = charLine;
        }
      } else {
        line = testLine;
      }
    }
    if (line) totalLines++;
  }
  return totalLines * lineH;
}

function buildTextTexture(text, colW, colH) {
  const oc   = document.createElement('canvas');
  oc.width   = colW;
  oc.height  = colH;
  const octx = oc.getContext('2d');

  const cut = 35; // Size of the top corner chamfer

  // Path for traditional Jibang paper shape (chamfered top corners)
  octx.beginPath();
  octx.moveTo(0, cut);
  octx.lineTo(cut, 0);
  octx.lineTo(colW - cut, 0);
  octx.lineTo(colW, cut);
  octx.lineTo(colW, colH);
  octx.lineTo(0, colH);
  octx.closePath();

  // Rice paper fill — white at 0.7 opacity
  octx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  octx.fill();

  // Clip the canvas to the Jibang paper shape so fibers/text do not bleed out
  octx.save();
  octx.beginPath();
  octx.moveTo(0, cut);
  octx.lineTo(cut, 0);
  octx.lineTo(colW - cut, 0);
  octx.lineTo(colW, cut);
  octx.lineTo(colW, colH);
  octx.lineTo(0, colH);
  octx.closePath();
  octx.clip();

  // Subtle fibre texture
  const rng = mulberry32(0xdeadbeef);
  for (let i = 0; i < 200; i++) {
    const x = rng() * colW;
    const y = rng() * colH;
    const l = rng() * 28 + 8;
    const a = (rng() * 0.5 - 0.25) * Math.PI / 5;
    octx.beginPath();
    octx.moveTo(x, y);
    octx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    octx.strokeStyle = `rgba(0,0,0,${rng() * 0.04 + 0.01})`;
    octx.lineWidth   = rng() * 0.5 + 0.2;
    octx.stroke();
  }

  // Text: Noto Sans KR, 16px, line-height 25.6px, top-padding 45px to clear the cut corners
  const px = 30, py = 45, fontSize = 16, lineH = 25.6;
  octx.font         = `400 ${fontSize}px 'Noto Sans KR', sans-serif`;
  octx.textBaseline = 'top';
  const maxW = colW - px * 2;
  octx.fillStyle = '#000000';
  drawParagraph(octx, text, px, py, maxW, lineH);

  octx.restore();

  return oc;
}

let offLeft  = null;
let offRight = null;

// ─────────────────────────────────────────────
//  Cloth simulation (Verlet integration)
// ─────────────────────────────────────────────
const COLS_PER_CLOTH  = 16;
const ROWS_PER_CLOTH  = 24;
const CONSTRAINT_ITER = 10;

class Particle {
  constructor(x, y, pinned) {
    this.x = x; this.y = y;
    this.px = x; this.py = y;
    this.pinned = pinned;
  }
  update(grav, damp, dt) {
    if (this.pinned) return;
    const vx = (this.x - this.px) * damp;
    const vy = (this.y - this.py) * damp;
    this.px = this.x; this.py = this.y;
    this.x += vx + grav.x * dt * dt;
    this.y += vy + grav.y * dt * dt;
  }
}

class Constraint {
  constructor(p1, p2) {
    this.p1 = p1; this.p2 = p2;
    const dx = p1.x - p2.x, dy = p1.y - p2.y;
    this.rest = Math.sqrt(dx * dx + dy * dy);
  }
  resolve() {
    const dx = this.p1.x - this.p2.x;
    const dy = this.p1.y - this.p2.y;
    const d  = Math.sqrt(dx * dx + dy * dy) || 0.001;
    const diff = (this.rest - d) / d * 0.5;
    const fx = dx * diff, fy = dy * diff;
    if (!this.p1.pinned) { this.p1.x += fx; this.p1.y += fy; }
    if (!this.p2.pinned) { this.p2.x -= fx; this.p2.y -= fy; }
  }
}

function drawJaggedCircle(ctx, cx, cy, baseR, noiseSeed) {
  ctx.beginPath();
  const numPoints = 100;
  for (let i = 0; i <= numPoints; i++) {
    const theta = (i / numPoints) * Math.PI * 2;
    const n = Math.sin(theta * 6 + noiseSeed) * 12 +
              Math.sin(theta * 13 - noiseSeed * 1.7) * 6 +
              Math.cos(theta * 25 + noiseSeed * 0.9) * 3;
    const r = Math.max(0, baseR + n);
    const x = cx + Math.cos(theta) * r;
    const y = cy + Math.sin(theta) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

class Cloth {
  constructor(x, y, width, height, cols, rows) {
    this.ox = x; this.oy = y;
    this.width = width; this.height = height;
    this.cols = cols; this.rows = rows;
    const cw = width / (cols - 1);
    const ch = height / (rows - 1);

    this.particles   = [];
    this.constraints = [];

    // click-to-burn states
    this.isBurning = false;
    this.burnProgress = 0;
    this.burnStartPoint = null;
    this.isFullyBurned = false;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const pinned = (r === 0);
        const p = new Particle(x + c * cw, y + r * ch, pinned);
        if (!pinned) p.x += (Math.random() - 0.5) * 0.2;
        this.particles.push(p);
      }
    }

    // Structural
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (c < cols - 1) this.constraints.push(new Constraint(this.particles[i], this.particles[i + 1]));
        if (r < rows - 1) this.constraints.push(new Constraint(this.particles[i], this.particles[i + cols]));
      }
    }
    // Shear
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const i = r * cols + c;
        this.constraints.push(new Constraint(this.particles[i],     this.particles[i + cols + 1]));
        this.constraints.push(new Constraint(this.particles[i + 1], this.particles[i + cols]));
      }
    }
    // Bend
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols - 2; c++) {
        const i = r * cols + c;
        this.constraints.push(new Constraint(this.particles[i], this.particles[i + 2]));
      }
    }
    for (let r = 0; r < rows - 2; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        this.constraints.push(new Constraint(this.particles[i], this.particles[i + cols * 2]));
      }
    }
  }

  update(grav, damp, dt) {
    for (const p of this.particles) p.update(grav, damp, dt);
    for (let i = 0; i < CONSTRAINT_ITER; i++) {
      for (const c of this.constraints) c.resolve();
    }
  }

  applyWind(wx, wy, strength) {
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.pinned) continue;
      const row = Math.floor(i / this.cols);
      const rf  = (row / this.rows) ** 2;
      const tx  = (Math.random() - 0.5) * strength * 0.1;
      const ty  = (Math.random() - 0.5) * strength * 0.05;
      p.x += (wx * strength + tx) * rf;
      p.y += (wy * strength + ty) * rf;
    }
  }

  draw(ctx, texture, offCanvas, offCtx) {
    if (!texture || this.isFullyBurned) return;

    // Clear offscreen canvas
    offCtx.clearRect(0, 0, W, H);

    const cols = this.cols, rows = this.rows;
    const tw = texture.width, th = texture.height;
    const pw = tw / (cols - 1), ph = th / (rows - 1);

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const p00 = this.particles[r * cols + c];
        const p10 = this.particles[r * cols + c + 1];
        const p01 = this.particles[(r + 1) * cols + c];
        const p11 = this.particles[(r + 1) * cols + c + 1];
        drawTexturedQuad(offCtx, texture,
          p00.x, p00.y, p10.x, p10.y, p01.x, p01.y, p11.x, p11.y,
          c * pw, r * ph, pw, ph, tw, th
        );
      }
    }

    if (this.isBurning && this.burnStartPoint) {
      const cx = this.burnStartPoint.x;
      const cy = this.burnStartPoint.y;
      const maxRadius = 1200; // Large enough to cover whole cloth height
      const R = this.burnProgress * maxRadius;
      const noiseSeed = this.burnProgress * 15;

      offCtx.save();

      // 1. Charred edge
      offCtx.globalCompositeOperation = 'source-atop';
      offCtx.fillStyle = 'rgba(25, 12, 5, 0.9)';
      drawJaggedCircle(offCtx, cx, cy, R + 26, noiseSeed);
      offCtx.fill();

      // 2. Fire glow
      offCtx.fillStyle = 'rgba(235, 75, 10, 0.95)';
      drawJaggedCircle(offCtx, cx, cy, R + 9, noiseSeed);
      offCtx.fill();

      // 3. Hot core
      offCtx.fillStyle = 'rgba(255, 230, 140, 1.0)';
      drawJaggedCircle(offCtx, cx, cy, R + 2, noiseSeed);
      offCtx.fill();

      // 4. Erase
      offCtx.globalCompositeOperation = 'destination-out';
      offCtx.fillStyle = 'rgba(0,0,0,1)';
      drawJaggedCircle(offCtx, cx, cy, R, noiseSeed);
      offCtx.fill();

      offCtx.restore();
    }

    ctx.drawImage(offCanvas, 0, 0);
  }
}

function drawTexturedQuad(ctx, img, x0,y0,x1,y1,x2,y2,x3,y3, su,sv,sw,sh,iw,ih) {
  drawTexturedTriangle(ctx, img, x0,y0,su,sv,       x1,y1,su+sw,sv,     x2,y2,su,sv+sh,     iw,ih);
  drawTexturedTriangle(ctx, img, x1,y1,su+sw,sv,    x3,y3,su+sw,sv+sh,  x2,y2,su,sv+sh,     iw,ih);
}

function drawTexturedTriangle(ctx, img, x0,y0,u0,v0, x1,y1,u1,v1, x2,y2,u2,v2, imgW,imgH) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); ctx.lineTo(x2,y2);
  ctx.closePath();
  ctx.clip();

  const denom = (u0*(v1-v2) + u1*(v2-v0) + u2*(v0-v1));
  if (Math.abs(denom) < 1e-6) { ctx.restore(); return; }

  const a = (x0*(v1-v2) + x1*(v2-v0) + x2*(v0-v1)) / denom;
  const b = (x0*(u2-u1) + x1*(u0-u2) + x2*(u1-u0)) / denom;
  const c = (x0*(u1*v2-u2*v1) + x1*(u2*v0-u0*v2) + x2*(u0*v1-u1*v0)) / denom;
  const d = (y0*(v1-v2) + y1*(v2-v0) + y2*(v0-v1)) / denom;
  const e = (y0*(u2-u1) + y1*(u0-u2) + y2*(u1-u0)) / denom;
  const f = (y0*(u1*v2-u2*v1) + y1*(u2*v0-u0*v2) + y2*(u0*v1-u1*v0)) / denom;

  ctx.transform(a,d,b,e,c,f);
  ctx.globalAlpha = 0.95;
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

// ─────────────────────────────────────────────
//  Global cloth instances
// ─────────────────────────────────────────────
let clothLeft  = null;
let clothRight = null;

let offLeftCanvas  = null;
let offLeftCtx     = null;
let offRightCanvas = null;
let offRightCtx    = null;

const COL_W   = 315;
let   COL_H   = 554; // default base height

// Centering math: Total width = 315 * 2 + 12 = 642px
// LEFT_X = (1512 - 642) / 2 = 435px
// RIGHT_X = 435 + 315 + 12 = 762px
const LEFT_X  = 435;
const LEFT_Y  = 79;
const RIGHT_X = 762;
const RIGHT_Y = 79;

function buildCloths() {
  const hLeft = measureTextHeight(TEXT_LEFT, COL_W) + 90;
  const hRight = measureTextHeight(TEXT_RIGHT, COL_W) + 90;
  COL_H = Math.max(554, Math.ceil(Math.max(hLeft, hRight)));

  document.documentElement.style.setProperty('--col-h', COL_H + 'px');

  clothLeft  = new Cloth(LEFT_X,  LEFT_Y,  COL_W, COL_H, COLS_PER_CLOTH, ROWS_PER_CLOTH);
  clothRight = new Cloth(RIGHT_X, RIGHT_Y, COL_W, COL_H, COLS_PER_CLOTH, ROWS_PER_CLOTH);

  offLeft  = buildTextTexture(TEXT_LEFT,  COL_W, COL_H);
  offRight = buildTextTexture(TEXT_RIGHT, COL_W, COL_H);

  offLeftCanvas = document.createElement('canvas');
  offLeftCanvas.width = W;
  offLeftCanvas.height = H;
  offLeftCtx = offLeftCanvas.getContext('2d');

  offRightCanvas = document.createElement('canvas');
  offRightCanvas.width = W;
  offRightCanvas.height = H;
  offRightCtx = offRightCanvas.getContext('2d');
}

// ─────────────────────────────────────────────
//  Physics
// ─────────────────────────────────────────────
const gravity = { x: 0, y: 220 };
const damping = 0.95; // Stiffer cloth to reduce excessive fluttering
let idleTime  = 0;

// ─────────────────────────────────────────────
//  Mouse / touch mapping
// ─────────────────────────────────────────────
let mouse = { x: W / 2, y: H / 2, down: false };

function updateMousePos(cx, cy) {
  const rect = paperCanvas.getBoundingClientRect();
  if (rect.width > 0) {
    mouse.x = ((cx - rect.left) / rect.width)  * W;
    mouse.y = ((cy - rect.top)  / rect.height) * H;
  }
}

function handleColumnClick(mx, my) {
  if (gameStarted) return;

  // Left column bounds check
  if (mx >= LEFT_X && mx <= LEFT_X + COL_W && my >= LEFT_Y && my <= LEFT_Y + COL_H) {
    if (!clothLeft.isBurning && !clothLeft.isFullyBurned) {
      clothLeft.isBurning = true;
      clothLeft.burnStartPoint = { x: mx, y: my };
      clothLeft.burnProgress = 0;
    }
  }

  // Right column bounds check
  if (mx >= RIGHT_X && mx <= RIGHT_X + COL_W && my >= RIGHT_Y && my <= RIGHT_Y + COL_H) {
    if (!clothRight.isBurning && !clothRight.isFullyBurned) {
      clothRight.isBurning = true;
      clothRight.burnStartPoint = { x: mx, y: my };
      clothRight.burnProgress = 0;
    }
  }
}

// ─────────────────────────────────────────────
//  Sticker Drag and Drop Events
// ─────────────────────────────────────────────
function startDragging(type, clientX, clientY) {
  if (!gameStarted || isCollapsing) return;
  updateMousePos(clientX, clientY);
  activeDragSticker = {
    type: type,
    x: mouse.x,
    y: mouse.y
  };
}

function dropSticker() {
  if (!activeDragSticker) return;

  const mx = activeDragSticker.x;
  const my = activeDragSticker.y;

  // Find nearest stroke point
  let minDist = Infinity;
  let nearestPoint = null;

  for (let i = 0; i < maskPoints.length; i++) {
    const pt = maskPoints[i];
    const dx = mx - pt.x;
    const dy = my - pt.y;
    const dist = dx * dx + dy * dy; // Avoid Math.sqrt inside loop
    if (dist < minDist) {
      minDist = dist;
      nearestPoint = pt;
    }
  }

  minDist = Math.sqrt(minDist);

  // Snapping tolerance (120px)
  if (minDist <= 120 && nearestPoint) {
    // Determine dynamic size/scale: smaller at extremities to not bleed out too far
    const distToCenter = Math.hypot(nearestPoint.x - 756, nearestPoint.y - 420);
    let targetScale = 0.7 - (distToCenter / 800) * 0.25;
    targetScale = Math.max(0.4, Math.min(0.7, targetScale));

    stickers.push({
      type: activeDragSticker.type,
      x: activeDragSticker.x, // Slide start
      y: activeDragSticker.y,
      targetX: nearestPoint.x,
      targetY: nearestPoint.y,
      scale: targetScale,
      rotation: (Math.random() - 0.5) * 0.4, // Small satisfying hand-placed feel
      vx: 0, vy: 0, vr: 0
    });

    updateBalance();
  } else {
    // Dropped in a completely wrong place -> collapses the pile immediately
    stickers.push({
      type: activeDragSticker.type,
      x: activeDragSticker.x,
      y: activeDragSticker.y,
      targetX: activeDragSticker.x,
      targetY: activeDragSticker.y,
      scale: 0.6,
      rotation: (Math.random() - 0.5) * 0.4,
      vx: 0, vy: 0, vr: 0
    });
    triggerCollapse();
  }

  activeDragSticker = null;
}

function updateBalance() {
  if (stickers.length === 0) {
    updateGauge(50);
    return;
  }

  let sumX = 0;
  for (const s of stickers) {
    sumX += s.targetX;
  }
  const avgX = sumX / stickers.length;
  const diffX = avgX - 756;
  const maxDev = 120; // Safe threshold

  const pointerPercent = 50 + (diffX / maxDev) * 50;
  updateGauge(pointerPercent);

  // Balance collapse trigger
  if (Math.abs(diffX) > maxDev) {
    triggerCollapse();
  }
}

function updateGauge(percent) {
  const pointer = document.getElementById('gaugePointer');
  if (pointer) {
    pointer.style.left = `${Math.max(0, Math.min(100, percent))}%`;
  }
}

function triggerCollapse() {
  if (isCollapsing) return;
  isCollapsing = true;

  for (const s of stickers) {
    s.vx = (Math.random() - 0.5) * 300;
    s.vy = -150 - Math.random() * 200; // Initial bounce
    s.vr = (Math.random() - 0.5) * 6;  // Spin speed
  }

  collapseTimer = 0;
}

// Bind tray item triggers
function initTrayEvents() {
  document.querySelectorAll('.tray-item').forEach(item => {
    item.addEventListener('mousedown', (e) => {
      const type = item.getAttribute('data-type');
      startDragging(type, e.clientX, e.clientY);
    });
    item.addEventListener('touchstart', (e) => {
      const type = item.getAttribute('data-type');
      startDragging(type, e.touches[0].clientX, e.touches[0].clientY);
      e.preventDefault();
    }, { passive: false });
  });
}

// ─────────────────────────────────────────────
//  Mouse/Touch Canvas interactions
// ─────────────────────────────────────────────
paperCanvas.addEventListener('mousemove', e => updateMousePos(e.clientX, e.clientY));
paperCanvas.addEventListener('mousedown', e => {
  mouse.down = true;
  updateMousePos(e.clientX, e.clientY);
  handleColumnClick(mouse.x, mouse.y);
});
paperCanvas.addEventListener('mouseup',   () => { mouse.down = false; });
paperCanvas.addEventListener('touchmove',  e => { e.preventDefault(); updateMousePos(e.touches[0].clientX, e.touches[0].clientY); mouse.down = true; }, { passive: false });
paperCanvas.addEventListener('touchstart', e => {
  updateMousePos(e.touches[0].clientX, e.touches[0].clientY);
  mouse.down = true;
  handleColumnClick(mouse.x, mouse.y);
});
paperCanvas.addEventListener('touchend',   () => { mouse.down = false; });

// Window level handlers for sticker drag-and-drop
window.addEventListener('mousemove', (e) => {
  updateMousePos(e.clientX, e.clientY);
  if (activeDragSticker) {
    activeDragSticker.x = mouse.x;
    activeDragSticker.y = mouse.y;
  }
});
window.addEventListener('touchmove', (e) => {
  updateMousePos(e.touches[0].clientX, e.touches[0].clientY);
  if (activeDragSticker) {
    activeDragSticker.x = mouse.x;
    activeDragSticker.y = mouse.y;
  }
});
window.addEventListener('mouseup', () => {
  if (activeDragSticker) dropSticker();
});
window.addEventListener('touchend', () => {
  if (activeDragSticker) dropSticker();
});

// ─────────────────────────────────────────────
//  Render loop
// ─────────────────────────────────────────────
let lastTime = 0;

function animate(ts) {
  requestAnimationFrame(animate);

  const dt = Math.min((ts - lastTime) / 1000, 0.033);
  lastTime = ts;
  if (dt <= 0 || !clothLeft) return;

  // Gentle Idle Sway (random wind simulation)
  idleTime += dt;
  const swL = Math.sin(idleTime * 0.15 * Math.PI * 2) * 0.08;
  const swR = Math.sin(idleTime * 0.15 * Math.PI * 2 + Math.PI * 0.3) * 0.08;

  if (!clothLeft.isFullyBurned) {
    clothLeft.applyWind(swL, 0, 0.4);
    clothLeft.update(gravity, damping, dt);
  }
  if (!clothRight.isFullyBurned) {
    clothRight.applyWind(swR, 0, 0.4);
    clothRight.update(gravity, damping, dt);
  }

  // Update burn transitions
  if (clothLeft.isBurning && !clothLeft.isFullyBurned) {
    clothLeft.burnProgress += dt * 0.65;
    if (clothLeft.burnProgress >= 1.0) {
      clothLeft.isFullyBurned = true;
    }
  }
  if (clothRight.isBurning && !clothRight.isFullyBurned) {
    clothRight.burnProgress += dt * 0.65;
    if (clothRight.burnProgress >= 1.0) {
      clothRight.isFullyBurned = true;
    }
  }

  // Check Game Start state (both columns burned)
  if (clothLeft.isFullyBurned && clothRight.isFullyBurned && !gameStarted) {
    gameStarted = true;
    const bgTitleSvg = document.getElementById('bgTitleSvg');
    if (bgTitleSvg) {
      bgTitleSvg.classList.remove('solid');
      bgTitleSvg.classList.add('engraved');
    }
    document.getElementById('balanceGauge').classList.remove('hidden');
    document.getElementById('stickerTray').classList.remove('hidden');
  }

  // Physics update for collapse animation
  if (isCollapsing) {
    collapseTimer += dt;
    for (const s of stickers) {
      s.vy += 650 * dt; // gravity
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.rotation += s.vr * dt;

      // Bounce off bottom floor boundary
      const floor = 900;
      if (s.y > floor) {
        s.y = floor;
        s.vy = -s.vy * 0.35; // damp
        s.vx *= 0.6;         // friction
        s.vr *= 0.6;
      }
      // Bounce off side walls
      if (s.x < 50) { s.x = 50; s.vx = -s.vx * 0.5; }
      if (s.x > 1462) { s.x = 1462; s.vx = -s.vx * 0.5; }
    }

    if (collapseTimer > 2.0 && !gameOverShown) {
      gameOverShown = true;
      document.getElementById('gameOverOverlay').classList.remove('hidden');
    }
  }

  // Clear Canvas
  ctx.clearRect(0, 0, W, H);

  // Draw active columns if not fully burned
  if (!clothLeft.isFullyBurned) {
    clothLeft.draw(ctx, offLeft, offLeftCanvas, offLeftCtx);
  }
  if (!clothRight.isFullyBurned) {
    clothRight.draw(ctx, offRight, offRightCanvas, offRightCtx);
  }

  // Draw stickers in stacking mode
  if (gameStarted) {
    for (const s of stickers) {
      // Smooth slide animation on drop
      if (!isCollapsing) {
        s.x += (s.targetX - s.x) * 0.15;
        s.y += (s.targetY - s.y) * 0.15;
      }

      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rotation);
      const img = stickerImages[s.type];
      if (img && img.complete) {
        const baseW = stickerBaseWidths[s.type];
        const aspect = img.height / img.width;
        const w = baseW * s.scale;
        const h = baseW * aspect * s.scale;
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      }
      ctx.restore();
    }

    // Draw active dragging sticker
    if (activeDragSticker) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.translate(activeDragSticker.x, activeDragSticker.y);
      const img = stickerImages[activeDragSticker.type];
      if (img && img.complete) {
        const baseW = stickerBaseWidths[activeDragSticker.type];
        const aspect = img.height / img.width;
        const w = baseW * 0.6;
        const h = baseW * aspect * 0.6;
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      }
      ctx.restore();
    }
  }
}

// ─────────────────────────────────────────────
//  Game Controls & Setup
// ─────────────────────────────────────────────
function resetGame() {
  stickers = [];
  activeDragSticker = null;
  isCollapsing = false;
  gameOverShown = false;
  gameStarted = false;

  const bgTitleSvg = document.getElementById('bgTitleSvg');
  if (bgTitleSvg) {
    bgTitleSvg.classList.remove('engraved');
    bgTitleSvg.classList.add('solid');
  }

  document.getElementById('balanceGauge').classList.add('hidden');
  document.getElementById('stickerTray').classList.add('hidden');
  document.getElementById('gameOverOverlay').classList.add('hidden');

  updateGauge(50);
  buildCloths();
}

function initButtons() {
  document.getElementById('printBtn').addEventListener('click', () => {
    window.print();
  });
  document.getElementById('resetBtn').addEventListener('click', () => {
    resetGame();
  });
}

// ─────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────
initTrayEvents();
initButtons();

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    buildCloths();
    buildMaskPoints();
    requestAnimationFrame(animate);
  });
} else {
  buildCloths();
  buildMaskPoints();
  requestAnimationFrame(animate);
}
