'use strict';

// ═══════════════════════════════════════════════════════════
// FLOW ANIMATOR
// SVG spine line'ları üzerinde hıza bağlı daire animasyonu.
// Renderer'a dokunmaz — overlay layer'a yazar.
// ═══════════════════════════════════════════════════════════

const SVG_NS = 'http://www.w3.org/2000/svg';

// ── Ayarlar ────────────────────────────────────────────────
const PARTICLE_R      = 2.8;    // daire yarıçapı (px)
const PARTICLES_PER_M = 0.4;    // boru başına kaç daire (uzunluk bazlı)
const MIN_PARTICLES   = 1;      // minimum daire sayısı
const MAX_PARTICLES   = 6;      // maksimum daire sayısı
const PX_PER_M        = 18;     // svg-renderer ile aynı oran
const BASE_SPEED      = 40;     // px/s — v=1m/s için referans hız
const MAX_VIS_SPEED   = 120;    // px/s üst sınır (çok hızlı dönmesin)
const RAMP_ALPHA_RATE = 0.04;   // dairelerin fade-in hızı (0-1)
const FILL_SPEED_PX_S = 60; // sıvının boruyu doldurma hızı px/s (BASE_SPEED ile aynı olabilir)


// Renk: hıza göre beyazdan maviye
function particleColor(alpha) {
  return `rgba(120, 200, 255, ${(alpha * 0.7 + 0.15).toFixed(2)})`;
}

// ── Yardımcı: SVG element yarat ────────────────────────────
function svgEl(tag) {
  return document.createElementNS(SVG_NS, tag);
}

// ── Segment veri yapısı ────────────────────────────────────
// Her boru segmenti için:
// { x1, y1, x2, y2, lenPx, particles: [{ t, alpha }] }
// t: 0–1 arası konum (0=giriş, 1=çıkış)

export class FlowAnimator {
  /**
   * @param {SVGGElement} overlayLayer  — renderer'ın _layerOverlay'i
   */
  constructor(overlayLayer) {
    this._layer     = overlayLayer;
    this._segments  = [];     // aktif segment listesi
    this._circles   = [];     // SVG circle elementleri (segment bazlı array of array)
    this._running   = false;
    this._rafId     = null;
    this._lastTime  = null;
    this._rampF     = 0;      // pompa ramp faktörü (0→1)
  }

  // ── Public API ─────────────────────────────────────────────

  /**
   * Layout ve snapshot değişince çağrılır.
   * @param {Array}  layouts   — pipelineStore.layout
   * @param {object} snapshot  — engine snapshot (nodes içerir)
   */
  update(layouts, snapshot) {
    this._rampF = snapshot?.rampFactor ?? 0;
    this._syncSegments(layouts, snapshot);
  }

  start() {
    if (this._running) return;
    this._running  = true;
    this._lastTime = null;
    this._startTime = performance.now() / 1000;
    this._rafId    = requestAnimationFrame(t => this._loop(t));
  }

  stop() {
    this._running = false;
    this._startTime = null;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._clearCircles();
    this._segments = [];
  }

  // ── Segment senkronizasyonu ────────────────────────────────

_syncSegments(layouts, snapshot) {
  const nodes = snapshot?.nodes ?? [];
  const now   = performance.now() / 1000;

  const newSegs = layouts.map((l, i) => {
    const node    = nodes[i];
    const v       = node?.v ?? 0;
    const blocked = node?.nodeState === 'blocked' || node?.nodeState === 'dry';
    const lenPx   = Math.hypot(l.ox - l.ix, l.oy - l.iy);

    // Mevcut segmenti koru — arrivalTime'ı değiştirme
    const existing = this._segments[i];
    if (existing) {
      existing.v       = v;
      existing.blocked = blocked;
      return existing;
    }

    // Yeni segment — arrivalTime hesapla
    // Bir önceki segmentin arrivalTime + dolma süresi
    const prev         = this._segments[i - 1] ?? null;
    const prevArrival  = prev?.arrivalTime ?? this._startTime ?? now;
    const prevLen      = prev?.lenPx ?? 0;
    const fillDuration = prevLen / FILL_SPEED_PX_S;
    const arrivalTime  = i === 0 ? (this._startTime ?? now) : prevArrival + fillDuration;

    const count = Math.min(MAX_PARTICLES,
                    Math.max(MIN_PARTICLES, Math.round((lenPx / PX_PER_M) * PARTICLES_PER_M)));

    const particles = Array.from({ length: count }, (_, k) => ({
      t: k / count, alpha: 0,
    }));

    return { x1: l.ix, y1: l.iy, x2: l.ox, y2: l.oy, lenPx, v, blocked, count, particles, arrivalTime };
  });

  // Sadece yeni segmentler eklendiyse circles'ı yeniden oluştur
  if (newSegs.length !== this._segments.length) {
    this._segments = newSegs;
    this._rebuildCircles();
  } else {
    this._segments = newSegs;
  }
}

  // ── SVG circle elementlerini yeniden oluştur ───────────────

  _rebuildCircles() {
    this._clearCircles();
    this._circles = this._segments.map(seg => {
      return seg.particles.map(() => {
        const c = svgEl('circle');
        c.setAttribute('r', PARTICLE_R);
        c.setAttribute('pointer-events', 'none');
        c.classList.add('flow-particle');
        this._layer.appendChild(c);
        return c;
      });
    });
  }

  _clearCircles() {
    // Overlay layer'dan sadece flow-particle class'lıları sil
    this._layer.querySelectorAll('.flow-particle').forEach(el => el.remove());
    this._circles = [];
  }

  // ── Ana animasyon döngüsü ──────────────────────────────────

  _loop(timestamp) {
    if (!this._running) return;

    const dt = this._lastTime ? Math.min((timestamp - this._lastTime) / 1000, 0.05) : 0;
    this._lastTime = timestamp;

    this._step(dt);

    this._rafId = requestAnimationFrame(t => this._loop(t));
  }

_step(dt) {
  const now = performance.now() / 1000;

  this._segments.forEach((seg, si) => {
    const circles = this._circles[si];
    if (!circles?.length) return;

    // Sıvı henüz buraya ulaşmadıysa dondur
    const arrived = now >= (seg.arrivalTime ?? 0);
    if (!arrived) {
      circles.forEach(c => { c.style.display = 'none'; });
      return;
    }

    const visSpeed = seg.blocked
      ? 0
      : Math.min(MAX_VIS_SPEED, seg.v * BASE_SPEED) * this._rampF;

    const dt_t = seg.lenPx > 0 ? (visSpeed * dt) / seg.lenPx : 0;

    seg.particles.forEach((p, pi) => {
      p.t = (p.t + dt_t) % 1;
      p.alpha = seg.blocked
        ? Math.max(0, p.alpha - RAMP_ALPHA_RATE)
        : Math.min(1, p.alpha + RAMP_ALPHA_RATE);

      const c  = circles[pi];
      const px = seg.x1 + (seg.x2 - seg.x1) * p.t;
      const py = seg.y1 + (seg.y2 - seg.y1) * p.t;
      c.setAttribute('cx', px.toFixed(1));
      c.setAttribute('cy', py.toFixed(1));
      c.setAttribute('fill', particleColor(p.alpha * this._rampF));
      c.style.display = p.alpha < 0.02 ? 'none' : '';
    });
  });
}
}
