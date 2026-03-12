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
const BLADE_COUNT     = 4;
const BLADE_LEN       = 7;      // px
const BLADE_WIDTH     = 2.2;    // px
const PUMP_RPM_DEG_S  = 360;    // derece/s tam hızda
const PUMP_R          = 12;     // pump.js shapeSpec ile aynı
const INERTIA_DECAY   = 2.8;    // rad/s² yavaşlama (stop'ta)

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
	  this._pumpAngle    = 0;   // rad — anlık açı
	  this._pumpOmega   = 0;   // rad/s — anlık açısal hız
	  this._pumpCenter  = null; // { cx, cy } SVG koordinatı

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

	_syncPumpCenter(layouts, snapshot) {
		// layouts[0] her zaman pompa (pipeline-store kuralı)
		const l = layouts?.[0];
		if (!l) { this._pumpCenter = null; return; }

		const len = Math.hypot(l.ox - l.ix, l.oy - l.iy);
		const mx  = l.ix + (l.ox - l.ix) / 2;
		const my  = l.iy + (l.oy - l.iy) / 2;
		this._pumpCenter = { cx: mx, cy: my };
	}
  // ── Public API ─────────────────────────────────────────────

  /** Her engine tick'te çağrılır */
	update(layouts, snapshot) {
		this._rampF      = snapshot?.rampFactor ?? 0;
		this._pumpState  = snapshot?.pumpState  ?? 'STOPPED';
		this._syncSegments(layouts, snapshot);
		this._syncPumpCenter(layouts, snapshot);
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
	  this._pumpState = 'STOPPED';
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
		this._running = false;
		this._pumpOmega = 0;  // inertia bekleme — direkt öldür
		if (this._rafId) {
			cancelAnimationFrame(this._rafId);
			this._rafId = null;
		}
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
		// running=false ama omega hâlâ varsa devam et (inertia)
		if (!this._running && this._pumpOmega < 0.01) {
			this._rafId = null;
			this._ctx.clearRect(0, 0, this._w, this._h);
			return;
		}
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
	this._stepPump(dt);

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


	_stepPump(dt) {
		if (!this._pumpCenter) return;

		const state   = this._pumpState ?? 'STOPPED';
		const ramp    = this._rampF ?? 0;
		const omega   = (PUMP_RPM_DEG_S * Math.PI / 180); // rad/s max

		// Hedef açısal hız
		const targetOmega = omega * ramp;

		// Smooth geçiş — stop'ta inertia, start'ta ramp
		if (state === 'STOPPED' || state === 'OVERLOAD') {
			// İnertia ile yavaşla
			this._pumpOmega = Math.max(0, this._pumpOmega - INERTIA_DECAY * dt);
		} else {
			// rampFactor zaten smooth geçiş yapıyor — direkt takip et
			this._pumpOmega += (targetOmega - this._pumpOmega) * Math.min(1, dt * 3);
		}

		this._pumpAngle += this._pumpOmega * dt;

		// Canvas koordinatına dönüştür
		const svgRect = this._svg.getBoundingClientRect();
		const vb      = this._svg.viewBox.baseVal;
		const scaleX  = svgRect.width  / (vb.width  || svgRect.width);
		const scaleY  = svgRect.height / (vb.height || svgRect.height);
		const offX    = -vb.x * scaleX;
		const offY    = -vb.y * scaleY;

		const cx = this._pumpCenter.cx * scaleX + offX;
		const cy = this._pumpCenter.cy * scaleY + offY;
		const r  = PUMP_R ;

		// OVERLOAD'da kırmızımsı renk
		const isOverload = state === 'OVERLOAD';
		const alpha      = 0.55 + ramp * 0.35;
		const color      = isOverload
			? `rgba(255, 120, 80, ${alpha})`
			: `rgba(120, 200, 255, ${alpha})`;     // parçacıklarla aynı renk ailesi

		const ctx = this._ctx;
		ctx.save();
		ctx.strokeStyle = color;
		ctx.lineWidth   = BLADE_WIDTH;
		ctx.lineCap     = 'round';

		for (let i = 0; i < BLADE_COUNT; i++) {
			const angle = this._pumpAngle + (i * Math.PI * 2) / BLADE_COUNT;
			const x1    = cx + Math.cos(angle) * (r * 0.25);  // merkeze yakın başla
			const y1    = cy + Math.sin(angle) * (r * 0.25);
			const x2    = cx + Math.cos(angle) * (r * 0.82);  // çember içinde bit
			const y2    = cy + Math.sin(angle) * (r * 0.82);

			ctx.beginPath();
			ctx.moveTo(x1, y1);
			ctx.lineTo(x2, y2);
			ctx.stroke();
		}

		// Merkez nokta
		ctx.beginPath();
		ctx.arc(cx, cy, 1.8, 0, Math.PI * 2);
		ctx.fillStyle = color;
		ctx.fill();

		ctx.restore();
	}
}