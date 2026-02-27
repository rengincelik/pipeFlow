'use strict';

// FLOW ANIMATOR
// SVG spine line'ları üzerinde hıza bağlı daire animasyonu.
// Renderer'a dokunmaz — overlay layer'a yazar.
// ═══════════════════════════════════════════════════════════
 

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



export class FlowAnimator {
  constructor(svgElement, canvasElement) {
    this._svg     = svgElement;
    this._canvas  = canvasElement;
    this._ctx     = canvasElement.getContext('2d');
    this._segments  = [];
    this._running   = false;
    this._rafId     = null;
    this._lastTime  = null;
    this._rampF     = 0;
    this._startTime = null;

    // Canvas boyutunu SVG ile senkron tut
    this._ro = new ResizeObserver(() => this._syncSize());
    this._ro.observe(svgElement);
    this._syncSize();
  }

  _syncSize() {
    const rect = this._svg.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;
    this._canvas.width  = rect.width  * dpr;
    this._canvas.height = rect.height * dpr;
    this._canvas.style.width  = rect.width  + 'px';
    this._canvas.style.height = rect.height + 'px';
    this._ctx.scale(dpr, dpr);
    this._w = rect.width;
    this._h = rect.height;
  }


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
    if (this._ctx) this._ctx.clearRect(0, 0, this._w, this._h);
    this._segments = [];
  }


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
    } else {
      this._segments = newSegs;
    }
  }



  _loop(timestamp) {
    if (!this._running) return;

    const dt = this._lastTime ? Math.min((timestamp - this._lastTime) / 1000, 0.05) : 0;
    this._lastTime = timestamp;

    this._step(dt);

    this._rafId = requestAnimationFrame(t => this._loop(t));
  }

  _step(dt) {
      const now = performance.now() / 1000;
      const ctx = this._ctx;

      // Her frame canvas temizle
      ctx.clearRect(0, 0, this._w, this._h);

      // SVG'nin canvas içindeki offset'ini al
      // SVG viewBox ile canvas koordinatları eşleşmeli
      const svgRect = this._svg.getBoundingClientRect();
      const vb      = this._svg.viewBox.baseVal;

      // ViewBox → Canvas koordinat dönüşümü
      const scaleX = svgRect.width  / (vb.width  || svgRect.width);
      const scaleY = svgRect.height / (vb.height || svgRect.height);
      const offX   = -vb.x * scaleX;
      const offY   = -vb.y * scaleY;

      this._segments.forEach((seg, si) => {
        const arrived = now >= (seg.arrivalTime ?? 0);
        if (!arrived) return;

        const visSpeed = seg.blocked
          ? 0
          : Math.min(MAX_VIS_SPEED, seg.v * BASE_SPEED) * this._rampF;

        const dt_t = seg.lenPx > 0 ? (visSpeed * dt) / seg.lenPx : 0;

        seg.particles.forEach(p => {
          p.t = (p.t + dt_t) % 1;

          p.alpha = seg.blocked
            ? Math.max(0, p.alpha - RAMP_ALPHA_RATE)
            : Math.min(1, p.alpha + RAMP_ALPHA_RATE);

          if (p.alpha < 0.02) return;

          // SVG koordinatını Canvas koordinatına çevir
          const svgX = seg.x1 + (seg.x2 - seg.x1) * p.t;
          const svgY = seg.y1 + (seg.y2 - seg.y1) * p.t;
          const cx   = svgX * scaleX + offX;
          const cy   = svgY * scaleY + offY;

          const alpha = p.alpha * this._rampF;

          ctx.beginPath();
          ctx.arc(cx, cy, PARTICLE_R, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(120, 200, 255, ${(alpha * 0.7 + 0.15).toFixed(2)})`;
          ctx.fill();
        });
      });
    }
}
