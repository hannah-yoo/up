/**
 * paper.js — Rice Paper Cloth Simulation for "UP"
 *
 * Two semi-transparent columns of "한지 (hanji)" rice paper pinned at the top.
 * Reacts to:
 *   - Mouse/touch: drag distorts the fabric
 *   - Microphone volume: breath blows the paper away from center
 */

'use strict';

// ─────────────────────────────────────────────
//  Canvas setup
// ─────────────────────────────────────────────
const paperCanvas = document.getElementById('paperCanvas');
const ctx         = paperCanvas.getContext('2d');

const W = 1512;
const H = 982;

function resize() {
  const scaleX = window.innerWidth / W;
  const scaleY = window.innerHeight / H;
  const scale = Math.min(scaleX, scaleY);
  document.documentElement.style.setProperty('--scale', scale);
}

// Set canvas dimensions once
paperCanvas.width = W;
paperCanvas.height = H;

window.addEventListener('resize', resize);
resize(); // Initial scale setup

// ─────────────────────────────────────────────
//  Offscreen text textures for each column
// ─────────────────────────────────────────────
const TEXT_LEFT = `한국의 오래된 괴담처럼 전해지는 고려장 설화에서는 집안에서 부양하기 힘든 어른을 지게에 태워 산속으로 보내 버렸다고 한다. 지금으로서는 듣기만 해도 천인공노할 일이지만 만약 그 어른들이 처단당해 마땅할 업보를 쌓았다고 상상해 보면 이야기는 조금 달라질 수도 있다. 살아생전에 나쁜 업을 그득그득 쌓았더라도 어른은 어른이라고 정성스레 지게에 태워 고즈넉한 산속까지 모셨다고 생각해 보면 고려장 지게는 마지막 가시는 길에 효를 다하는 꽃상여 같다는 생각도 든다.`;

const TEXT_RIGHT = `이승을 떠난 사후세계에서부터는 진정한 업보의 되갚음이 시작될지도 모른다. 망자가 살아생전 타고 온 지게에 염라대왕이 지난 업보의 무게를 그득그득 쌓아놓고서는 업고 가라 명할 수도 있고, 황천길을 건너는 도중에는 갈 곳 없는 영혼들이 지게에 들러붙어 영영 놓아주지 않을 수도 있다. 이처럼 업業 에서는 한국의 장례와 사후세계에 관련된 토속적 설화들을 차용해 업을 쌓은 이가 업고 가는 탈것을 관객들과 함께 상상해 보고자 한다.\n웹 포스터와 글: 유해나 @hannah.yoo.hy`;

let offscreenLeft  = null;
let offscreenRight = null;

function buildTextTexture(text, colW, colH, isRightColumn = false) {
  const oc = document.createElement('canvas');
  oc.width  = colW;
  oc.height = colH;
  const octx = oc.getContext('2d');

  // Rice paper base — white with 0.7 opacity as designed in Figma
  octx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  octx.fillRect(0, 0, colW, colH);

  // Subtle fibre texture — random light streaks for rice paper aesthetic
  const rng = mulberry32(0xdeadbeef);
  for (let i = 0; i < 240; i++) {
    const x  = rng() * colW;
    const y  = rng() * colH;
    const l  = rng() * 30 + 10;
    const a  = (rng() * 0.5 - 0.25) * Math.PI / 6; // near-horizontal
    octx.beginPath();
    octx.moveTo(x, y);
    octx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    octx.strokeStyle = `rgba(0, 0, 0, ${rng() * 0.04 + 0.01})`;
    octx.lineWidth = rng() * 0.6 + 0.2;
    octx.stroke();
  }

  // Korean text layout: Padding 30px, Font Size 16px, Line Height 25.6px
  const paddingX  = 30;
  const paddingY  = 30;
  const fontSize  = 16;
  const lineHeight = 25.6;
  octx.font = `400 ${fontSize}px 'Noto Sans KR', sans-serif`;
  octx.textBaseline = 'top';

  const maxWidth = colW - paddingX * 2;
  
  if (isRightColumn) {
    // Split paragraph and credits line
    const parts = text.split('\n');
    const mainParagraph = parts[0];
    const creditLine = parts[1];

    octx.fillStyle = '#000000';
    let currentY = drawParagraph(octx, mainParagraph, paddingX, paddingY, maxWidth, lineHeight);
    
    // Figma style override 30: #696969 color for credit line
    octx.fillStyle = '#696969';
    // Add extra space before credit line if it fits
    currentY += lineHeight;
    drawParagraph(octx, creditLine, paddingX, currentY, maxWidth, lineHeight);
  } else {
    octx.fillStyle = '#000000';
    drawParagraph(octx, text, paddingX, paddingY, maxWidth, lineHeight);
  }

  return oc;
}

function drawParagraph(ctx, text, x, y, maxWidth, lineHeight) {
  let line = '';
  let curY = y;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const testLine = line + ch;
    if (ctx.measureText(testLine).width > maxWidth && line.length > 0) {
      ctx.fillText(line, x, curY);
      line = ch;
      curY += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) {
    ctx.fillText(line, x, curY);
  }
  return curY + lineHeight;
}

// Simple seedable RNG (mulberry32)
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ─────────────────────────────────────────────
//  Cloth simulation
// ─────────────────────────────────────────────
const COLS_PER_CLOTH = 16;   // grid columns
const ROWS_PER_CLOTH = 24;   // grid rows
const CONSTRAINT_ITER = 10;  // solver iterations (more = stiffer)

class Particle {
  constructor(x, y, pinned) {
    this.x  = x;  this.y  = y;
    this.px = x;  this.py = y; // previous position (Verlet)
    this.pinned = pinned;
    this.vx = 0; this.vy = 0;  // not used directly, inferred from pos delta
  }

  update(gravity, damping, dt) {
    if (this.pinned) return;
    const vx = (this.x - this.px) * damping;
    const vy = (this.y - this.py) * damping;
    this.px = this.x;
    this.py = this.y;
    this.x += vx + gravity.x * dt * dt;
    this.y += vy + gravity.y * dt * dt;
  }
}

class Constraint {
  constructor(p1, p2) {
    this.p1 = p1;
    this.p2 = p2;
    const dx = p1.x - p2.x, dy = p1.y - p2.y;
    this.rest = Math.sqrt(dx * dx + dy * dy);
  }

  resolve() {
    const dx = this.p1.x - this.p2.x;
    const dy = this.p1.y - this.p2.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
    const diff = (this.rest - dist) / dist;
    const factor = 0.5;
    const fx = dx * diff * factor;
    const fy = dy * diff * factor;
    if (!this.p1.pinned) { this.p1.x += fx; this.p1.y += fy; }
    if (!this.p2.pinned) { this.p2.x -= fx; this.p2.y -= fy; }
  }
}

class Cloth {
  constructor(x, y, width, height, cols, rows) {
    this.ox     = x;
    this.oy     = y;
    this.width  = width;
    this.height = height;
    this.cols   = cols;
    this.rows   = rows;

    const cw = width  / (cols - 1);
    const ch = height / (rows - 1);

    this.particles   = [];
    this.constraints = [];

    // Build grid
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const pinned = (r === 0); // top row is pinned
        const p = new Particle(x + c * cw, y + r * ch, pinned);
        // tiny initial random displacement to break symmetry
        if (!pinned) { p.x += (Math.random() - 0.5) * 0.5; }
        this.particles.push(p);
      }
    }

    // Structural constraints (horizontal + vertical)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (c < cols - 1) this.constraints.push(new Constraint(this.particles[idx], this.particles[idx + 1]));
        if (r < rows - 1) this.constraints.push(new Constraint(this.particles[idx], this.particles[idx + cols]));
      }
    }

    // Shear constraints (diagonal)
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const idx = r * cols + c;
        this.constraints.push(new Constraint(this.particles[idx],          this.particles[idx + cols + 1]));
        this.constraints.push(new Constraint(this.particles[idx + 1],      this.particles[idx + cols]));
      }
    }

    // Bend (skip-1) constraints for stiffness
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols - 2; c++) {
        const idx = r * cols + c;
        this.constraints.push(new Constraint(this.particles[idx], this.particles[idx + 2]));
      }
    }
    for (let r = 0; r < rows - 2; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        this.constraints.push(new Constraint(this.particles[idx], this.particles[idx + cols * 2]));
      }
    }
  }

  update(gravity, damping, dt) {
    for (const p of this.particles) p.update(gravity, damping, dt);
    for (let i = 0; i < CONSTRAINT_ITER; i++) {
      for (const c of this.constraints) c.resolve();
    }
  }

  applyForce(mx, my, radius, strength) {
    for (const p of this.particles) {
      if (p.pinned) continue;
      const dx = p.x - mx, dy = p.y - my;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < radius * radius) {
        const dist = Math.sqrt(dist2) || 0.001;
        const f = (1 - dist / radius) * strength;
        p.x += (dx / dist) * f;
        p.y += (dy / dist) * f;
      }
    }
  }

  // Directional wind/blow force (used for mic)
  applyWind(wx, wy, strength) {
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.pinned) continue;
      // apply more force to lower rows (paper bottom flutters more)
      const row = Math.floor(i / this.cols);
      const rowFactor = (row / this.rows) * (row / this.rows); // quadratic — tip flutters most
      // add turbulence per-particle so it looks organic
      const turbX = (Math.random() - 0.5) * strength * 0.25;
      const turbY = (Math.random() - 0.5) * strength * 0.12;
      p.x += (wx * strength + turbX) * rowFactor;
      p.y += (wy * strength + turbY) * rowFactor;
    }
  }

  /**
   * Draw the cloth using bilinear quad patches, sampling the offscreen texture.
   */
  draw(ctx, texture) {
    if (!texture) return;
    ctx.save();

    const cols = this.cols, rows = this.rows;
    const texW = texture.width, texH = texture.height;
    const patchW = texW / (cols - 1);
    const patchH = texH / (rows - 1);

    // Draw each quad as a small canvas transform
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const p00 = this.particles[r * cols + c];
        const p10 = this.particles[r * cols + c + 1];
        const p01 = this.particles[(r + 1) * cols + c];
        const p11 = this.particles[(r + 1) * cols + c + 1];

        // Use two triangles per quad to draw texture
        drawTexturedQuad(ctx, texture,
          p00.x, p00.y, p10.x, p10.y, p01.x, p01.y, p11.x, p11.y,
          c * patchW, r * patchH, patchW, patchH,
          texW, texH
        );
      }
    }

    ctx.restore();
  }
}

/**
 * Draw a textured quad using canvas 2D transforms.
 * Splits into two triangles. Each triangle maps texture coords.
 */
function drawTexturedQuad(ctx, img, x0,y0, x1,y1, x2,y2, x3,y3, su,sv, sw,sh, iw,ih) {
  // top-left, top-right, bottom-left, bottom-right

  // Triangle 1: TL, TR, BL
  drawTexturedTriangle(ctx, img,
    x0, y0, su,      sv,
    x1, y1, su + sw, sv,
    x2, y2, su,      sv + sh,
    iw, ih
  );
  // Triangle 2: TR, BR, BL
  drawTexturedTriangle(ctx, img,
    x1, y1, su + sw, sv,
    x3, y3, su + sw, sv + sh,
    x2, y2, su,      sv + sh,
    iw, ih
  );
}

/**
 * Draw a single textured triangle.
 * Uses canvas 2D affine transform to map texture onto screen triangle.
 */
function drawTexturedTriangle(ctx, img,
  x0, y0, u0, v0,
  x1, y1, u1, v1,
  x2, y2, u2, v2,
  imgW, imgH
) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.closePath();
  ctx.clip();

  // Solve affine transform: screen = M * texture + b
  // [x0 x1 x2]   [u0 u1 u2]
  // [y0 y1 y2] = M * [v0 v1 v2] + b

  const denom = (u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1));
  if (Math.abs(denom) < 1e-6) { ctx.restore(); return; }

  const a = ((x0 * (v1 - v2) + x1 * (v2 - v0) + x2 * (v0 - v1)) / denom);
  const b = ((x0 * (u2 - u1) + x1 * (u0 - u2) + x2 * (u1 - u0)) / denom);
  const c = ((x0 * (u1*v2 - u2*v1) + x1*(u2*v0 - u0*v2) + x2*(u0*v1 - u1*v0)) / denom);
  const d = ((y0 * (v1 - v2) + y1 * (v2 - v0) + y2 * (v0 - v1)) / denom);
  const e = ((y0 * (u2 - u1) + y1 * (u0 - u2) + y2 * (u1 - u0)) / denom);
  const f = ((y0 * (u1*v2 - u2*v1) + y1*(u2*v0 - u0*v2) + y2*(u0*v1 - u1*v0)) / denom);

  ctx.transform(a, d, b, e, c, f);
  ctx.globalAlpha = 0.92;
  ctx.drawImage(img, 0, 0);

  ctx.restore();
}

// ─────────────────────────────────────────────
//  Global state
// ─────────────────────────────────────────────
let clothLeft  = null;
let clothRight = null;

function buildCloths() {
  // Exact column dimensions and coordinates from Figma (Node 14-16)
  const colW   = 216.5;
  const colH   = 606;
  const startY = 80;
  const leftX  = 529;
  const rightX = 765.5;

  clothLeft  = new Cloth(leftX,  startY, colW, colH, COLS_PER_CLOTH, ROWS_PER_CLOTH);
  clothRight = new Cloth(rightX, startY, colW, colH, COLS_PER_CLOTH, ROWS_PER_CLOTH);

  // Rebuild textures with Noto Sans KR and exact spacing
  offscreenLeft  = buildTextTexture(TEXT_LEFT,  Math.round(colW), Math.round(colH), false);
  offscreenRight = buildTextTexture(TEXT_RIGHT, Math.round(colW), Math.round(colH), true);
}

// ─────────────────────────────────────────────
//  Physics parameters
// ─────────────────────────────────────────────
const gravity  = { x: 0, y: 220 };  // px/s² — slightly heavier so paper hangs taught
const damping  = 0.988;             // velocity damping each frame (higher = less oscillation)
let micVolume  = 0;                 // 0–1 normalised mic amplitude
let idleTime   = 0;                 // accumulated time for idle oscillation

// ─────────────────────────────────────────────
//  Mouse / touch interaction
// ─────────────────────────────────────────────
let mouse = { x: W / 2, y: H / 2, down: false };

function updateMousePos(clientX, clientY) {
  const rect = paperCanvas.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    mouse.x = ((clientX - rect.left) / rect.width) * W;
    mouse.y = ((clientY - rect.top) / rect.height) * H;
  }
}

paperCanvas.addEventListener('mousemove', e => {
  updateMousePos(e.clientX, e.clientY);
});
paperCanvas.addEventListener('mousedown', e => {
  mouse.down = true;
  updateMousePos(e.clientX, e.clientY);
});
paperCanvas.addEventListener('mouseup',   () => { mouse.down = false; });

paperCanvas.addEventListener('touchmove', e => {
  e.preventDefault();
  updateMousePos(e.touches[0].clientX, e.touches[0].clientY);
  mouse.down = true;
}, { passive: false });
paperCanvas.addEventListener('touchstart', e => {
  updateMousePos(e.touches[0].clientX, e.touches[0].clientY);
  mouse.down = true;
});
paperCanvas.addEventListener('touchend', () => { mouse.down = false; });

// ─────────────────────────────────────────────
//  Microphone: request & analyse
// ─────────────────────────────────────────────
let audioCtx   = null;
let analyser   = null;
let micStream  = null;
let micData    = null;

async function initMic() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    micStream = stream;
    audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    micData = new Uint8Array(analyser.frequencyBinCount);

    // Hide hint after permission granted
    setTimeout(() => {
      document.getElementById('micHint').classList.add('hidden');
    }, 3000);
  } catch (err) {
    console.warn('Mic access denied or unavailable:', err);
    document.getElementById('micHint').querySelector('.mic-text').textContent = '마우스로 한지를 만져보세요';
  }
}

function updateMicVolume() {
  if (!analyser || !micData) { micVolume *= 0.9; return; }
  analyser.getByteTimeDomainData(micData);
  let sum = 0;
  for (let i = 0; i < micData.length; i++) {
    const v = (micData[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / micData.length);
  // Smooth + normalise: typical speaking is ~0.05–0.3 RMS
  micVolume = micVolume * 0.75 + Math.min(rms / 0.25, 1.0) * 0.25;
}

// ─────────────────────────────────────────────
//  Render loop
// ─────────────────────────────────────────────
let lastTime = 0;

function animate(ts) {
  requestAnimationFrame(animate);

  const dt = Math.min((ts - lastTime) / 1000, 0.033); // cap at ~30fps physics
  lastTime = ts;
  if (dt <= 0) return;

  updateMicVolume();

  // Mouse interaction
  const mouseRadius   = 60;
  const mouseStrength = mouse.down ? 18 : 6;
  clothLeft.applyForce(mouse.x, mouse.y, mouseRadius, mouseStrength);
  clothRight.applyForce(mouse.x, mouse.y, mouseRadius, mouseStrength);

  // ── Idle oscillation: subtle breathing / sway even without input
  idleTime += dt;
  const idleAmp = 0.4; // very gentle
  const idleFreq = 0.4;
  const swayL = Math.sin(idleTime * idleFreq * Math.PI * 2) * idleAmp;
  const swayR = Math.sin(idleTime * idleFreq * Math.PI * 2 + Math.PI * 0.3) * idleAmp;
  clothLeft.applyWind(swayL, 0, 1.0);
  clothRight.applyWind(swayR, 0, 1.0);

  // ── Mic / breath — blow outward from centre, slightly upward
  if (micVolume > 0.06) {
    // Scale: at full breath (volume=1), strength ≈ 8. Gentle flutter, not fly-off.
    const windStrength = Math.pow((micVolume - 0.06) / 0.94, 1.4) * 9;
    clothLeft.applyWind(-1.0, -0.15, windStrength);   // left column blows left
    clothRight.applyWind(1.0, -0.15, windStrength);   // right column blows right
  }

  clothLeft.update(gravity, damping, dt);
  clothRight.update(gravity, damping, dt);

  // Draw
  ctx.clearRect(0, 0, W, H);
  clothLeft.draw(ctx,  offscreenLeft);
  clothRight.draw(ctx, offscreenRight);
}

// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────
resize();
initMic();

if (document.fonts) {
  document.fonts.ready.then(() => {
    buildCloths();
    requestAnimationFrame(animate);
  });
} else {
  buildCloths();
  requestAnimationFrame(animate);
}
