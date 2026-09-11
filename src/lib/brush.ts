// Deterministic brush renderer for the homepage ensō.
// Stroke velocity controls width; ink flow and paper texture control coverage.

export type Point = [number, number, number];

export const MAX_WIDTH = 22; // slow strokes - thick
export const MIN_WIDTH = 4; // fast strokes - thin
const VMIN = 0.08; // px/ms - considered "slow"
const VMAX = 5.0; // px/ms - considered "fast"
const ROLLING_SIZE = 4; // samples smoothed for width transitions
const REF = 320; // reference scale (px) velocity + width are computed at

function calcVelocity(
  x1: number, y1: number, t1: number, x2: number, y2: number, t2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dt = Math.max(1, t2 - t1);
  return Math.sqrt(dx * dx + dy * dy) / dt;
}

function velocityToWidth(v: number): number {
  const clamped = Math.max(VMIN, Math.min(VMAX, v));
  const t = 1 - (clamped - VMIN) / (VMAX - VMIN); // 1 = slow, 0 = fast
  return MIN_WIDTH + t * (MAX_WIDTH - MIN_WIDTH);
}

function velocityToOpacity(v: number): number {
  const clamped = Math.max(VMIN, Math.min(VMAX, v));
  const t = 1 - (clamped - VMIN) / (VMAX - VMIN);
  return 0.7 + t * 0.3;
}

// ---------------------------------------------------------------------------
// THE BRUSH (fude)
//
// The mark is derived from the TOOL, not drawn directly. The brush carries a
// bundle of hairs and a two-tank ink reservoir - a belly that feeds a tip - and
// the paper has a tooth. Kasure (the dry-brush flying white) is therefore not
// painted: it is what is left when only some hairs still reach the paper, which
// is why the strands run long and taper instead of breaking into dashes.
//
// Width and opacity still come from the velocity curves above, unchanged, so the
// feel is the one ported from the native app. Everything else is derived from
// the points at render time and NOTHING is stored.
//
// Determinism: every noise input is either the arc length in 320-space, a hair
// index, or a position in 320-space. Nothing is hashed from the stamp counter,
// which would change with the canvas size. There is no Math.random and no Date,
// so the same points paint the same picture, at any size, forever.
// ---------------------------------------------------------------------------

// Brush and paper parameters.
const FLOW = 0.62; // ink density at the nib
// This mark is ONE stroke that has to close, so the brush is loaded heavier than
// a hand-drawn ensō would be - at 1.3 the tail ran out of ink just before the
// join and the ring never visibly met. Kasure still arrives, just later.
const INK_SPAN = 1.6; // how far one load of ink travels
const KASURE = 0.55; // how readily the dry brush breaks up
const GRAIN = 0.35; // how much the band wanders off a drawn arc
const PRESS = 0.3; // how heavily a loaded brush lands
const BLEED = 0.35; // how far ink creeps into the paper
const TOOTH = 0.6; // how much the paper's surface shows

const DEP = 0.0045; // ink laid down per 320-px at full width
const FEED = 0.03; // capillary refill from the belly per 320-px
const INK_GAIN = 1.85; // maps FLOW onto a sumi-black density
const RELEASE = 26; // 320-px over which the brush lifts off
const W_SMOOTH = 7; // 320-px the footprint takes to follow a width change
// half the tangent integral of the dab profile below, which is what an overlap
// of dabs is really worth. Without it every stroke comes out washed out.
const DAB_EFF = 0.6;

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// deterministic hash: n -> [0,1)
function h1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
// 1D value noise, smooth by construction, so anything driven by it fades in and
// out over its wavelength instead of stepping between cells
function nz(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return h1(seed + i * 127.31) * (1 - u) + h1(seed + (i + 1) * 127.31) * u;
}
function fbm(seed: number, x: number): number {
  return nz(seed, x) * 0.65 + nz(seed + 91.7, x * 2.3) * 0.35;
}
function h2(i: number, j: number): number {
  return h1(i * 37.13 + j * 91.71);
}
function nz2(x: number, y: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = h2(i, j);
  const b = h2(i + 1, j);
  const c = h2(i, j + 1);
  const d = h2(i + 1, j + 1);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}
// the paper's surface, sampled in 320-space so the grain is the same grain at
// any canvas size
function toothAt(xr: number, yr: number): number {
  return nz2(xr * 0.62, yr * 0.62) * 0.55 + nz2(xr * 1.9 + 13.1, yr * 1.9 + 7.7) * 0.45;
}

// catmull-rom (uniform, tension .5) through p1..p2 with neighbours p0, p3
function cr(
  p0: number[], p1: number[], p2: number[], p3: number[], u: number,
): number[] {
  const u2 = u * u;
  const u3 = u2 * u;
  return [
    0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * u + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * u2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * u3),
    0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * u + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3),
  ];
}

// The lateral profile a stroke ends up with is the dab's profile integrated
// along the tangent, so a flat dab accumulates into a SEMICIRCLE - a soft edge
// however hard the sprite is. Weighting the dab toward its rim by 1/sqrt(1-r^2)
// makes that integral constant, which lands a flat-topped stroke with a real
// edge. It is also what ink does: it dries darkest at its own boundary, so the
// same weighting leaves the faint rim a wet stroke really has. The outer taper
// is the other half - a hard-edged dab leaves its own outline showing as a faint
// ring wherever the ink has not saturated.
function inkProfile(r: number, k: number, taper: number): number {
  if (r >= 1) return 0;
  return Math.min(1, k / Math.sqrt(1 - r * r)) * smoothstep(1, taper, r);
}

type SpriteKind = "body" | "hair" | "bleed";
const spriteCache = new Map<string, HTMLCanvasElement>();
function getSprite(inkHex: string, kind: SpriteKind): HTMLCanvasElement {
  const key = inkHex + "|" + kind;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const S = 64; // a dab lands at 10-25px, so this is plenty and cheap to sample
  const cv = document.createElement("canvas");
  cv.width = S;
  cv.height = S;
  const g = cv.getContext("2d")!;
  const r = parseInt(inkHex.slice(1, 3), 16);
  const gr = parseInt(inkHex.slice(3, 5), 16);
  const b = parseInt(inkHex.slice(5, 7), 16);
  const img = g.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    const dy = ((y + 0.5) / S) * 2 - 1;
    for (let x = 0; x < S; x++) {
      const dx = ((x + 0.5) / S) * 2 - 1;
      const rad = Math.sqrt(dx * dx + dy * dy);
      let a: number;
      if (kind === "body") a = inkProfile(rad, 0.5, 0.86);
      // a hair lands about a pixel wide, so it wants to be solid rather than rim
      // weighted - at that size the weighting only hollows it out
      else if (kind === "hair") a = inkProfile(rad, 0.78, 0.72);
      // the bleed is diffusion, not contact, so it is the one soft thing here
      else a = Math.pow(clamp(1 - rad, 0, 1), 1.7) * 0.55;
      const i = (y * S + x) * 4;
      d[i] = r;
      d[i + 1] = gr;
      d[i + 2] = b;
      d[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  spriteCache.set(key, cv);
  return cv;
}

// The bundle. Hairs sit at uneven lateral positions and each belongs to the clump
// nearest it, so when the tip splits they gather into a few broad strands the way
// a real bundle does rather than fanning into even stripes.
const HAIR_N = 14;
const CLUMPS = [-0.79, -0.31, 0.2, 0.72];
interface Hair {
  u: number;
  clumped: number;
  ci: number;
  bias: number;
  thick: number;
  seed: number;
}
const HAIRS: Hair[] = (() => {
  const out: Hair[] = [];
  for (let j = 0; j < HAIR_N; j++) {
    const base = ((j + 0.5) / HAIR_N) * 2 - 1;
    const u = clamp(base + (h1(j * 12.9898 + 4.1) - 0.5) * (3.4 / HAIR_N), -1, 1);
    let c = CLUMPS[0];
    let ci = 0;
    for (let q = 0; q < CLUMPS.length; q++) {
      if (Math.abs(CLUMPS[q] - u) < Math.abs(c - u)) {
        c = CLUMPS[q];
        ci = q;
      }
    }
    out.push({
      u,
      clumped: c + (u - c) * 0.12,
      ci,
      // the outside of the bundle holds least ink, so kasure opens from the edges in
      bias: clamp(0.82 + 0.36 * h1(j * 71.7 + 3.1) - 0.34 * u * u, 0.2, 1.3),
      // some of these are really a few hairs stuck together, so they run wide
      thick: 0.55 + 1.5 * Math.pow(h1(j * 23.9 + 11.7), 2),
      seed: 40.1 + j * 137.31,
    });
  }
  return out;
})();

// total stroke length in 320-space. Chord lengths are close enough at these
// sample rates, and it is what the release taper measures back from.
function arcLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = (points[i][0] - points[i - 1][0]) * REF;
    const dy = (points[i][1] - points[i - 1][1]) * REF;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

// A live stroke. Hold one of these while drawing: feed() paints only what is
// newly complete, so a pointermove never repaints the stroke, and finish() does
// the one full-quality pass with the release taper and the flick.
export class EnsoBrush {
  private ctx: CanvasRenderingContext2D;
  private size: number;
  private dpr: number;
  private bleedCtx: CanvasRenderingContext2D;
  private inkCtx: CanvasRenderingContext2D;
  private inkHex = "#2b2b2b";
  private sBody!: HTMLCanvasElement;
  private sHair!: HTMLCanvasElement;
  private sBleed!: HTMLCanvasElement;
  private segIdx = 1;
  private carry = 0;
  private arc = 0;
  private tip = 1;
  private belly = 1;
  private pool = 0;
  private widthHist: number[] = [];
  private wSm: number | null = null;
  private wPrev: number | null = null;
  private slowPrev = 0;
  private opPrev: number | null = null;
  private tan: [number, number] = [1, 0];
  private lastPos: [number, number] | null = null;
  private spacing = 1;
  private totalArc = Infinity;

  constructor(ctx: CanvasRenderingContext2D, size: number, ink: string) {
    this.ctx = ctx;
    this.size = size;
    this.dpr = ctx.canvas.width / size;
    // two layers so the wet bleed always sits UNDER the body. Painted into the
    // same canvas it would scallop the stroke's own edge on every stamp.
    this.bleedCtx = this.makeLayer();
    this.inkCtx = this.makeLayer();
    this.begin(ink);
  }

  private makeLayer(): CanvasRenderingContext2D {
    const cv = document.createElement("canvas");
    cv.width = Math.round(this.size * this.dpr);
    cv.height = Math.round(this.size * this.dpr);
    const g = cv.getContext("2d")!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return g;
  }

  begin(ink: string, totalArc = Infinity): void {
    this.inkHex = ink;
    this.sBody = getSprite(ink, "body");
    this.sHair = getSprite(ink, "hair");
    this.sBleed = getSprite(ink, "bleed");
    this.segIdx = 1;
    this.carry = 0;
    this.arc = 0;
    this.tip = 1; // ink available where the hairs meet the paper
    this.belly = 1; // the reservoir up in the body of the brush
    this.pool = 0; // ink gathering where the stroke dwells
    this.widthHist = [];
    this.wSm = null;
    this.wPrev = null;
    this.slowPrev = 0;
    this.opPrev = null;
    this.tan = [1, 0];
    this.lastPos = null;
    this.spacing = 1;
    // live drawing does not know where the stroke ends, so no release taper.
    // A replay DOES know, so it can taper as it goes and never needs a re-render.
    this.totalArc = totalArc;
    this.squareUp();
    const s = this.size;
    this.bleedCtx.clearRect(0, 0, s, s);
    this.inkCtx.clearRect(0, 0, s, s);
    this.ctx.clearRect(0, 0, s, s);
  }

  // paint whatever is newly complete. A segment needs its next neighbour to
  // curve through, so live painting runs one point behind the pointer.
  feed(points: Point[]): void {
    const maxSeg = points.length - 2;
    let painted = false;
    while (this.segIdx <= maxSeg) {
      this.paintSeg(points, this.segIdx);
      this.segIdx++;
      painted = true;
    }
    if (painted) this.flush();
  }

  // Close a stroke that has already been fed: paint whatever is left, then the
  // flick. No re-render, so ending a replay costs nothing.
  seal(points: Point[]): void {
    for (let i = this.segIdx; i < points.length; i++) this.paintSeg(points, i);
    this.segIdx = points.length;
    this.flush();
  }

  // the one full-quality pass, for a stroke nothing has drawn yet
  finish(points: Point[]): void {
    if (!points || points.length < 3) {
      this.begin(this.inkHex);
      return;
    }
    this.begin(this.inkHex, arcLength(points));
    this.seal(points);
  }

  // one clear and two blits, so live drawing never repaints a single dab twice
  private flush(): void {
    this.squareUp();
    const s = this.size;
    this.ctx.clearRect(0, 0, s, s);
    this.ctx.drawImage(this.bleedCtx.canvas, 0, 0, s, s);
    this.ctx.drawImage(this.inkCtx.canvas, 0, 0, s, s);
  }

  // put both layers back into plain logical space after a run of dabs
  private squareUp(): void {
    const d = this.dpr;
    this.bleedCtx.setTransform(d, 0, 0, d, 0, 0);
    this.bleedCtx.globalAlpha = 1;
    this.inkCtx.setTransform(d, 0, 0, d, 0, 0);
    this.inkCtx.globalAlpha = 1;
  }

  private paintSeg(points: Point[], i: number): void {
    const size = this.size;
    const k = size / REF;
    const n = points.length;
    const P = (j: number): number[] => {
      const p = points[clamp(j, 0, n - 1)];
      return [p[0] * size, p[1] * size];
    };
    const a = points[i - 1];
    const b = points[i];

    // width and slowness come from the production curves, untouched
    const v = calcVelocity(a[0] * REF, a[1] * REF, a[2], b[0] * REF, b[1] * REF, b[2]);
    const raw = velocityToWidth(v);
    this.widthHist = [...this.widthHist, raw].slice(-ROLLING_SIZE);
    const wB = this.widthHist.reduce((s, x) => s + x, 0) / this.widthHist.length;
    const slowB = 1 - (clamp(v, VMIN, VMAX) - VMIN) / (VMAX - VMIN);
    const opB = velocityToOpacity(v); // the production curve, called not copied
    const wA = this.wPrev == null ? wB : this.wPrev;
    const slowA = this.wPrev == null ? slowB : this.slowPrev;
    const opA = this.opPrev == null ? opB : this.opPrev;
    this.wPrev = wB;
    this.slowPrev = slowB;
    this.opPrev = opB;
    const vNorm = clamp((v - VMIN) / (VMAX - VMIN), 0, 1);

    const p0 = P(i - 2);
    const p1 = P(i - 1);
    const p2 = P(i);
    const p3 = P(i + 1);
    const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const steps = Math.max(1, Math.ceil(chord / 1.1));
    let prev: number[] = this.lastPos ? [this.lastPos[0], this.lastPos[1]] : cr(p0, p1, p2, p3, 0);

    for (let s = 1; s <= steps; s++) {
      const u = s / steps;
      const pt = cr(p0, p1, p2, p3, u);
      const dx = pt[0] - prev[0];
      const dy = pt[1] - prev[1];
      const d = Math.hypot(dx, dy);
      if (d > 0.0001) {
        this.tan = [dx / d, dy / d];
        const d320 = d / k;
        const raw320 = wA + (wB - wA) * u;
        const slow = slowA + (slowB - slowA) * u;
        const op = opA + (opB - opA) * u;
        // A bundle of hair has inertia: it cannot change its footprint in 4px of
        // travel. Millisecond-quantised timestamps make the width curve jump
        // between neighbouring samples, which a solid line hides but stamped
        // dabs turn into a soft beaded edge.
        this.wSm =
          this.wSm == null
            ? raw320
            : this.wSm + (raw320 - this.wSm) * (1 - Math.exp(-d320 / W_SMOOTH));
        const w320 = this.wSm;
        this.advanceInk(d320, w320, slow);
        this.arc += d320;
        this.carry += d;
        const w = w320 * k;
        // Spacing sets the overdraw, and the overdraw is what costs. Keep it
        // PROPORTIONAL to the width so the overlap per dab is the same at any
        // stroke width - a fixed clamp made a wide stroke pay several times over
        // for the same result.
        this.spacing = Math.max(0.8, Math.min(2.4, this.effWidth(w) * 0.08));
        while (this.carry >= this.spacing) {
          this.carry -= this.spacing;
          const back = this.carry / d;
          this.stampAt(pt[0] - dx * back, pt[1] - dy * back, w, slow, op, vNorm);
        }
      }
      prev = pt;
    }
    this.lastPos = [prev[0], prev[1]];
  }

  // The whole wet-to-dry story. The tip gives ink up to the paper and the belly
  // gives it back, slower, and faster while the brush dwells. So the stroke does
  // not fade on a ramp: it runs dry, recovers a little where the hand slows, and
  // only truly empties once the belly has nothing left to give.
  private advanceInk(d320: number, w320: number, slow: number): void {
    const dep = (d320 * (w320 / MAX_WIDTH) * DEP) / INK_SPAN;
    this.tip = Math.max(0, this.tip - dep);
    // capillary flow is uneven, which is what stops the stroke drying on a ramp
    const wander = 0.6 + 0.8 * fbm(311.9, this.arc / 55);
    const rate = FEED * (0.3 + 0.7 * slow) * wander;
    const feed = Math.min(this.belly, d320 * rate * this.belly * (1 - this.tip));
    this.tip = Math.min(1, this.tip + feed);
    this.belly -= feed;
    // ink gathers only where the hand really dwells, and lets go slowly
    this.pool += (slow * slow - this.pool) * Math.min(1, d320 * 0.11);
  }

  // 0 normally, rising to 1 through the release. Lifting narrows the mark AND
  // starves it, which is why a released stroke flies white before it ends.
  private lift(): number {
    if (this.totalArc === Infinity) return 0;
    const rem = this.totalArc - this.arc;
    return rem >= RELEASE ? 0 : clamp(1 - Math.max(0, rem) / RELEASE, 0, 1);
  }

  private effWidth(w: number): number {
    // the tip touches before the belly does, so the mark OPENS OUT of nothing
    // rather than landing as a full round stamp
    const settle = smoothstep(0, 1, clamp(this.arc / 15, 0, 1));
    let e = w * (0.7 + 0.3 * this.tip);
    // the press rides the settle, or it spikes into a bulb on the first few px
    e *= 1 + PRESS * settle * Math.exp(-this.arc / 16);
    e *= 1 + 0.13 * this.pool;
    e *= 0.3 + 0.7 * settle;
    e *= 1 - 0.86 * this.lift();
    return Math.max(0.45, e);
  }

  private density(op: number): number {
    let d = FLOW * INK_GAIN * op; // op IS velocityToOpacity, the shared curve
    d *= 0.42 + 0.58 * this.tip;
    d *= 1 + 0.3 * this.pool;
    return clamp(d, 0, 0.985);
  }

  // the touch-down is wetter than the rest of the stroke. It belongs to the ink
  // the hairs lay down, NOT to what creeps into the paper around them.
  private landing(): number {
    return 1 + 0.35 * Math.exp(-this.arc / 13);
  }

  private dryness(vNorm: number): number {
    const base = 1.45 * (1 - this.tip) + 0.62 * vNorm - 0.44 + 0.55 * this.lift();
    return clamp(base * 2.0 * KASURE, 0, 1);
  }

  // Dabs overlap, so painting each at the density we want would stack far past
  // it. Solve for the per-dab alpha that accumulates back to the target.
  private dabAlpha(target: number, along: number): number {
    const n = Math.max(1, (along / this.spacing) * DAB_EFF);
    return 1 - Math.pow(1 - clamp(target, 0, 0.985), 1 / n);
  }

  // setTransform beats save/translate/rotate/restore here: one call instead of
  // five, and a stroke lays down thousands of these. The tangent IS the
  // rotation, so there is no atan2 either.
  private dab(
    g: CanvasRenderingContext2D,
    sprite: HTMLCanvasElement,
    x: number, y: number, w: number, len: number, alpha: number,
  ): void {
    if (alpha <= 0.0015 || w <= 0.04) return;
    const [tx, ty] = this.tan;
    const d = this.dpr;
    g.setTransform(d * tx, d * ty, -d * ty, d * tx, d * x, d * y);
    g.globalAlpha = alpha;
    g.drawImage(sprite, -len / 2, -w / 2, len, w);
  }

  private stampAt(
    x: number, y: number, w: number, slow: number, op: number, vNorm: number,
  ): void {
    const k = this.size / REF;
    const arc = this.arc;
    const wEff = this.effWidth(w);
    const dry = this.dryness(vNorm);
    const dens = this.density(op);
    const [tx, ty] = this.tan;
    const nx = -ty;
    const ny = tx;

    // the band wanders a little, so no edge of the enso is ever a drawn arc
    const wander = (fbm(770.3, arc / 24) - 0.5) * wEff * 0.17 * GRAIN;
    const cx = x + nx * wander;
    const cy = y + ny * wander;
    const tooth = toothAt(cx / k, cy / k);

    // a fast brush trails its tip, so the footprint stretches along the travel
    const stretch = 1.12 + 0.55 * vNorm;

    // 1. bleed. Ink creeps into the paper where the stroke is slow and loaded,
    // and it creeps along the fibres it finds, so the fringe is blotchy. An even
    // one round the whole stroke is an airbrush, not paper.
    const wet = clamp(this.tip * (0.35 + 0.65 * slow) * (1 - dry) - 0.12, 0, 1);
    if (wet > 0.02) {
      const bw = wEff * (1.13 + 0.22 * wet * BLEED);
      const bl = Math.max(bw * stretch, this.spacing * 1.4);
      const bd = dens * wet * BLEED * 0.3 * (0.45 + 1.1 * tooth);
      this.dab(this.bleedCtx, this.sBleed, cx, cy, bw, bl, this.dabAlpha(bd, bl));
    }

    // 2. body. It recedes as the brush dries until only hairs are left.
    const bodyW = wEff * (1 - 0.55 * dry);
    const bodyL = Math.max(bodyW * stretch, this.spacing * 1.35);
    const bodyD = dens * this.landing() * (1 - 0.99 * dry) * (1 - 0.34 * TOOTH * (1 - tooth));
    this.dab(this.inkCtx, this.sBody, cx, cy, bodyW, bodyL, this.dabAlpha(bodyD, bodyL));

    // 3. hairs. The hairs never go away, they are just buried in the ink while it
    // is wet. Letting the outside of the bundle graze the edge gives a wet stroke
    // a fibre edge instead of a silhouette, and makes both ends of the stroke
    // read as the same brush.
    const show = 0.3 + 0.7 * smoothstep(0.0, 0.22, dry);
    const buried = show < 0.45; // inner hairs are under the body, do not pay for them
    const split = smoothstep(0.05, 0.4, dry);
    const spread = 0.96 + 0.16 * dry;
    const half = wEff * 0.5;
    for (let j = 0; j < HAIR_N; j++) {
      const hair = HAIRS[j];
      if (buried && Math.abs(hair.u) < 0.7) continue;
      // each hair drifts on its own, or every strand wobbles in step and the dry
      // stretch comes out looking combed
      const drift = (nz(hair.seed + 21.3, arc / 38) - 0.5) * 0.34;
      // a split bundle wanders as a bundle, or the strands come out as tram lines
      const sway = (nz(700.7 + hair.ci * 53.1, arc / 45) - 0.5) * 0.4;
      const uEff =
        (hair.u + (hair.clumped + sway - hair.u) * split) * spread + drift * split;
      const off = uEff * half;
      const hx = cx + nx * off;
      const hy = cy + ny * off;
      // Supply against demand. Each hair holds its own ink, wandering slowly
      // along the stroke, and the paper asks for more of it as the brush dries.
      // Hairs lift off one by one, best-wetted last, so a strand thins away over
      // tens of px instead of switching off.
      const have = hair.bias * (0.48 + 0.52 * fbm(hair.seed, arc / 52));
      const ht = toothAt(hx / k, hy / k);
      const need = 0.18 + 0.8 * dry + 0.42 * TOOTH * (ht - 0.5);
      const contact = smoothstep(need - 0.18, need + 0.1, have);
      if (contact <= 0.03) continue;
      // a strand tapers by getting THINNER, not paler. Where a hair is still
      // down it is carrying the same ink the wet stroke had.
      const hw = Math.max(
        0.4,
        wEff * hair.thick * (0.045 + 0.05 * nz(hair.seed + 5.5, arc / 30)) * (0.25 + 0.75 * contact),
      );
      const hl = Math.max(hw * 2.2, this.spacing * 1.6);
      const hd = dens * show * (0.82 + 0.18 * contact);
      this.dab(this.inkCtx, this.sHair, hx, hy, hw, hl, this.dabAlpha(hd, hl));
    }
  }

}

// One-shot: paint a whole stroke and throw the brush away.
export function paintStroke(
  points: Point[],
  ctx: CanvasRenderingContext2D,
  size: number,
  ink: string,
): void {
  ctx.clearRect(0, 0, size, size);
  if (!points || points.length < 3) return;
  new EnsoBrush(ctx, size, ink).finish(points);
}

export { arcLength };
