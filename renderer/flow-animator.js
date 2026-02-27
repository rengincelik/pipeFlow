'use strict';

// ═══════════════════════════════════════════════════════════
// FLOW ANIMATOR
// Canvas tabanlı, hıza bağlı parçacık animasyonu.
// SVG koordinatlarını canvas'a dönüştürür.
// Hat değişiminde sıfırlanır, sıvı sırayla yayılır.
// ═══════════════════════════════════════════════════════════

// ── Ayarlar ────────────────────────────────────────────────
const PARTICLE_R      = 2.8;   // daire yarıçapı (px)
const PARTICLES_PER_M = 0.4;   // metre başına parçacık sayısı
const MIN_PARTICLES   = 1;
const MAX_PARTICLES   = 6;
const PX_PER_M        = 18;    // svg-renderer ile aynı
const BASE_SPEED      = 40;    // px/s — v=1m/s referans
const MAX_VIS_SPEED   = 120;   // px/s üst sınır
const RAMP_ALPHA_RATE = 0.04;  // fade-in hızı
const FILL_SPEED_PX_S = 60;    // sıvının boruyu doldurma hızı px/s


export class FlowAnimator {
  /**
   * @param {SVGSVGElement}      svgEl     — koordinat referansı
   * @param {HTMLCanvasElement}  canvasEl  — çizim yüzeyi
   */
  constructor(svgEl, canvasEl) {
    this._svg       = svgEl;
    this._canvas    = canvasEl;
    this._ctx       = canvasEl.getContext('2d');

    this._segments  = [];
    this._running   = false;
    this._rafId     = null;
    this._lastTime  = null;
    this._startTime = null;
    this._rampF     = 0;

    // Canvas boyutunu SVG ile senkron tut
    this._ro = new ResizeObserver(() => this._syncSize());
    this._ro.observe(svgEl);
    this._syncSize();
  }

  // ── Boyut senkronu ─────────────────────────────────────────
  _syncSize() {
    const rect = this._svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    this._canvas.width        = rect.width  * dpr;
    this._canvas.height       = rect.height * dpr;
    this._canvas.style.width  = rect.width  + 'px';
    this._canvas.style.height = rect.height + 'px';
    this._ctx.scale(dpr, dpr);
    this._w = rect.width;
    this._h = rect.height;
  }

  // ── Public API ─────────────────────────────────────────────

  /** Her engine tick'te çağrılır */
  update(layouts, snapshot) {
    this._rampF = snapshot?.rampFactor ?? 0;
    this._syncSegments(layouts, snapshot);
  }

  /** Pompa start'ta çağrılır */
  start() {
    if (this._running) return;
    this._running   = true;
    this._startTime = performance.now() / 1000;
    this._lastTime  = null;
    this._segments  = [];   // temiz başla
    this._rafId     = requestAnimationFrame(t => this._loop(t));
  }

  /** Pompa stop'ta çağrılır */
  stop() {
    this._running   = false;
    this._startTime = null;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._segments = [];
    if (this._ctx) this._ctx.clearRect(0, 0, this._w, this._h);
  }

  /** Hat değişince çağrılır — segmentleri sıfırla, zamanlayıcıyı koru */
  reset() {
    this._segments = [];
    if (this._ctx) this._ctx.clearRect(0, 0, this._w, this._h);
  }

  destroy() {
    this.stop();
    this._ro.disconnect();
  }

  // ── Segment senkronu ───────────────────────────────────────

  _syncSegments(layouts, snapshot) {
    const nodes = snapshot?.nodes ?? [];
    const now   = performance.now() / 1000;

    // newSegs'i biriktirerek oluşturuyoruz ki
    // arrivalTime zinciri doğru çalışsın
    const newSegs = [];

    layouts.forEach((l, i) => {
      const node    = nodes[i];
      const v       = node?.v ?? 0;
      const blocked = node?.nodeState === 'blocked' || node?.nodeState === 'dry';
      const lenPx   = Math.hypot(l.ox - l.ix, l.oy - l.iy);

      // Mevcut segment varsa koordinatları güncelle, parçacıkları koru
      const existing = this._segments[i];
      if (existing) {
        existing.x1      = l.ix;
        existing.y1      = l.iy;
        existing.x2      = l.ox;
        existing.y2      = l.oy;
        existing.lenPx   = lenPx;
        existing.v       = v;
        existing.blocked = blocked;
        newSegs.push(existing);
        return;
      }

      // Yeni segment — arrivalTime zinciri
      // newSegs'teki bir öncekine bak (this._segments değil)
      const prev         = newSegs[i - 1] ?? null;
      const prevArrival  = prev?.arrivalTime ?? this._startTime ?? now;
      const prevLen      = prev?.lenPx ?? 0;
      const fillDuration = prevLen / FILL_SPEED_PX_S;
      const arrivalTime  = i === 0
        ? (this._startTime ?? now)
        : prevArrival + fillDuration;

      const count = Math.min(MAX_PARTICLES,
        Math.max(MIN_PARTICLES, Math.round((lenPx / PX_PER_M) * PARTICLES_PER_M)));

      const particles = Array.from({ length: count }, (_, k) => ({
        t:     k / count,  // eşit aralıklı başlangıç
        alpha: 0,          // fade-in başlar
      }));

      newSegs.push({
        x1: l.ix, y1: l.iy,
        x2: l.ox, y2: l.oy,
        lenPx, v, blocked, count, particles, arrivalTime,
      });
    });

    this._segments = newSegs;
  }

  // ── Animasyon döngüsü ──────────────────────────────────────

  _loop(timestamp) {
    if (!this._running) return;
    const dt = this._lastTime
      ? Math.min((timestamp - this._lastTime) / 1000, 0.05)
      : 0;
    this._lastTime = timestamp;
    this._step(dt);
    this._rafId = requestAnimationFrame(t => this._loop(t));
  }

  _step(dt) {
    const now = performance.now() / 1000;
    const ctx = this._ctx;

    ctx.clearRect(0, 0, this._w, this._h);

    // SVG viewBox → Canvas koordinat dönüşümü
    const svgRect = this._svg.getBoundingClientRect();
    const vb      = this._svg.viewBox.baseVal;
    const scaleX  = svgRect.width  / (vb.width  || svgRect.width);
    const scaleY  = svgRect.height / (vb.height || svgRect.height);
    const offX    = -vb.x * scaleX;
    const offY    = -vb.y * scaleY;

    this._segments.forEach(seg => {
      // Sıvı henüz bu segmente ulaşmadı
      if (now < (seg.arrivalTime ?? 0)) return;

      const visSpeed = seg.blocked
        ? 0
        : Math.min(MAX_VIS_SPEED, seg.v * BASE_SPEED) * this._rampF;

      const dt_t = seg.lenPx > 0 ? (visSpeed * dt) / seg.lenPx : 0;

      seg.particles.forEach(p => {
        // Konum güncelle
        p.t = (p.t + dt_t) % 1;

        // Fade in / out
        p.alpha = seg.blocked
          ? Math.max(0, p.alpha - RAMP_ALPHA_RATE)
          : Math.min(1, p.alpha + RAMP_ALPHA_RATE);

        if (p.alpha < 0.02) return;

        // SVG → Canvas koordinat
        const svgX = seg.x1 + (seg.x2 - seg.x1) * p.t;
        const svgY = seg.y1 + (seg.y2 - seg.y1) * p.t;
        const cx   = svgX * scaleX + offX;
        const cy   = svgY * scaleY + offY;

        const a = (p.alpha * this._rampF * 0.7 + 0.15).toFixed(2);

        ctx.beginPath();
        ctx.arc(cx, cy, PARTICLE_R, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(120, 200, 255, ${a})`;
        ctx.fill();
      });
    });
  }
}

