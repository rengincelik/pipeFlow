'use strict';

// ═══════════════════════════════════════════════════════════════
// FLOW ANIMATOR
// Canvas-based particle animation along the full pipeline path.
// Particles spawn at the start of the pipeline and die at the end.
// Spawn rate is proportional to flow velocity.
// Elbow segments use quadratic Bézier interpolation (Q cx cy ox oy).
// Other segments use linear interpolation.
// ═══════════════════════════════════════════════════════════════

// <editor-fold desc="Constants">
const PARTICLE_R       = 2.8;   // particle circle radius (px)
const BASE_SPEED       = 40;    // px/s at v = 1 m/s reference
const MAX_VIS_SPEED    = 120;   // px/s upper cap
const FADE_RATE        = 0.06;  // alpha change per frame (fade in/out)
const SPAWN_BASE_IVL   = 0.55;  // base spawn interval (s) at reference speed
const MIN_SPAWN_IVL    = 0.08;  // minimum interval between spawns (s)
const BLADE_COUNT      = 4;
const BLADE_WIDTH      = 2.2;   // px
const PUMP_RPM_DEG_S   = 360;   // deg/s at full speed
const PUMP_R           = 12;    // must match pump.js shapeSpec
const INERTIA_DECAY    = 2.8;   // rad/s² deceleration on stop
// </editor-fold>

// <editor-fold desc="Color helpers">
function cssVar(name) {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || null;
}

function fluidColor(alpha) {
	const raw = cssVar('--c-fluid') ?? cssVar('--c-pipe') ?? '#78c8ff';
	return applyAlpha(raw, alpha);
}

function applyAlpha(color, alpha) {
	if (!color) return `rgba(120,200,255,${alpha})`;
	const c = color.trim();
	if (c.startsWith('rgba') || c.startsWith('rgb')) {
		return c.replace(/rgba?\(([^)]+)\)/, (_, inner) => {
			const parts = inner.split(',').map(s => s.trim());
			if (parts.length >= 3) return `rgba(${parts[0]},${parts[1]},${parts[2]},${alpha})`;
			return `rgba(${inner},${alpha})`;
		});
	}
	let h = c.replace('#', '');
	if (h.length === 3) h = h.split('').map(x => x + x).join('');
	const num = parseInt(h, 16);
	return `rgba(${(num >> 16) & 255},${(num >> 8) & 255},${num & 255},${alpha})`;
}
// </editor-fold>

// <editor-fold desc="Quadratic Bézier helpers">
/**
 * Point on a quadratic Bézier curve at parameter t ∈ [0, 1].
 * P(t) = (1-t)² P0 + 2(1-t)t P1 + t² P2
 */
function quadBezier(x0, y0, cx, cy, x1, y1, t) {
	const mt = 1 - t;
	return {
		x: mt * mt * x0 + 2 * mt * t * cx + t * t * x1,
		y: mt * mt * y0 + 2 * mt * t * cy + t * t * y1,
	};
}

/**
 * Approximate arc length of a quadratic Bézier by subdivision.
 * Used once per segment update to store lenPx accurately.
 * 16 subdivisions — sufficient for pipe bend radii.
 */
function quadBezierLength(x0, y0, cx, cy, x1, y1, steps = 16) {
	let len = 0;
	let px = x0, py = y0;
	for (let i = 1; i <= steps; i++) {
		const t = i / steps;
		const { x, y } = quadBezier(x0, y0, cx, cy, x1, y1, t);
		len += Math.hypot(x - px, y - py);
		px = x; py = y;
	}
	return len;
}
// </editor-fold>

export class FlowAnimator {
	/**
	 * @param {SVGSVGElement}     svgEl    — coordinate reference
	 * @param {HTMLCanvasElement} canvasEl — drawing surface
	 */
	constructor(svgEl, canvasEl) {
		this._svg    = svgEl;
		this._canvas = canvasEl;
		this._ctx    = canvasEl.getContext('2d');

		// Path: array of segment descriptors built from layout
		// Each segment: { x1,y1, x2,y2, cx?,cy?, isBezier,
		//                 lenPx, cumStart, v, blocked, negPressure }
		this._path     = [];
		this._totalLen = 0;

		// Active particles — each: { pos, alpha, dying }
		// pos    : distance from path start (px), 0 → totalLen
		// alpha  : current opacity 0–1
		// dying  : true when pos has reached totalLen (fade out phase)
		this._particles = [];

		// Spawn timer
		this._spawnTimer = 0;

		// Pump animation state
		this._pumpAngle  = 0;
		this._pumpOmega  = 0;
		this._pumpCenter = null;

		this._running   = false;
		this._rafId     = null;
		this._lastTime  = null;
		this._startTime = null;
		this._rampF     = 0;
		this._pumpState = 'STOPPED';

		this._ro = new ResizeObserver(() => this._syncSize());
		this._ro.observe(svgEl);
		this._syncSize();
	}

	_getCanvasCoords(svgX, svgY) {
		const svgRect = this._svg.getBoundingClientRect();
		const vb = this._svg.viewBox.baseVal;

		const scaleX = svgRect.width / (vb.width || svgRect.width);
		const scaleY = svgRect.height / (vb.height || svgRect.height);
		const offX = -vb.x * scaleX;
		const offY = -vb.y * scaleY;

		return {
			cx: svgX * scaleX + offX,
			cy: svgY * scaleY + offY
		};
	}
	// <editor-fold desc="Canvas size sync">
	_syncSize() {
		const rect = this._svg.getBoundingClientRect();
		if (!rect.width || !rect.height) return;
		const dpr = window.devicePixelRatio || 1;
		this._canvas.width        = rect.width  * dpr;
		this._canvas.height       = rect.height * dpr;
		this._canvas.style.width  = rect.width  + 'px';
		this._canvas.style.height = rect.height + 'px';
		this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		this._w = rect.width;
		this._h = rect.height;
	}
	// </editor-fold>

	// <editor-fold desc="Public API">
	/** Called every engine tick — updates layout and snapshot */
	update(layouts, snapshot) {
		this._rampF     = snapshot?.rampFactor ?? 0;
		this._pumpState = snapshot?.pumpState  ?? 'STOPPED';
		this._syncPath(layouts, snapshot);
		this._syncPumpCenter(layouts);
	}

	/** Called when pump starts */
	start() {
		if (this._running) return;
		this._running    = true;
		this._startTime  = performance.now() / 1000;
		this._lastTime   = null;
		this._particles  = [];
		this._spawnTimer = 0;
		this._rafId = requestAnimationFrame(t => this._loop(t));
	}

	/** Called when pump stops */
	stop() {
		this._running   = false;
		this._pumpState = 'STOPPED';
		this._startTime = null;
		if (this._rafId) {
			cancelAnimationFrame(this._rafId);
			this._rafId = null;
		}
		this._particles = [];
		if (this._ctx) this._ctx.clearRect(0, 0, this._w, this._h);
	}

	/** Called when pipeline components change — reset particles, keep timer */
	reset() {
		this._path       = [];
		this._totalLen   = 0;
		this._particles  = [];
		this._spawnTimer = 0;
		if (this._ctx) this._ctx.clearRect(0, 0, this._w, this._h);
	}

	destroy() {
		this._running   = false;
		this._pumpOmega = 0;
		if (this._rafId) {
			cancelAnimationFrame(this._rafId);
			this._rafId = null;
		}
		this._ro.disconnect();
	}
	// </editor-fold>

	// <editor-fold desc="Path sync">
	_syncPath(layouts, snapshot) {
		const nodes = snapshot?.nodes ?? [];
		let cumStart = 0;
		const newPath = [];

		const MIN_VISUAL_V = 0.05; // m/s — sadece animasyon için, fizik dışı

		layouts.forEach((l, i) => {
			const node        = nodes[i];
			const rawV        = node?.v ?? 0;
			const blocked     = node?.nodeState === 'blocked' || node?.nodeState === 'dry';
			const negPressure = node?.negativePressure ?? false;

// PRV aktifken gerçek v çok küçük olabilir — animasyon donmasın
			const v = (node?.subtype === 'prv' && node?.prvState === 'active')
				? Math.max(rawV, MIN_VISUAL_V)
				: rawV;

			const isBezier = (l.cornerX !== undefined && l.cornerY !== undefined);
			const lenPx    = isBezier
				? quadBezierLength(l.ix, l.iy, l.cornerX, l.cornerY, l.ox, l.oy)
				: Math.hypot(l.ox - l.ix, l.oy - l.iy);

			newPath.push({
				x1: l.ix, y1: l.iy,
				x2: l.ox, y2: l.oy,
				cx: l.cornerX, cy: l.cornerY,
				isBezier,
				lenPx,
				cumStart,
				v,
				blocked,
				negPressure,
			});

			cumStart += lenPx;
		});

		this._path     = newPath;
		this._totalLen = cumStart;

		// Clamp existing particle positions to the new total length
		if (this._particles.length && this._totalLen > 0) {
			this._particles = this._particles.filter(p => p.pos <= this._totalLen);
		}
	}

	_syncPumpCenter(layouts) {
		const l = layouts?.[0];
		if (!l) { this._pumpCenter = null; return; }
		this._pumpCenter = {
			cx: l.ix + (l.ox - l.ix) / 2,
			cy: l.iy + (l.oy - l.iy) / 2,
		};
	}
	// </editor-fold>

	// <editor-fold desc="Animation loop">
	_loop(timestamp) {
		// Keep looping while pump omega is non-zero even after stop (inertia)
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
		const ctx = this._ctx;
		ctx.clearRect(0, 0, this._w, this._h);

		this._stepPump(dt);

		if (!this._path.length || this._totalLen <= 0) return;

		const firstSeg = this._path.find(s => !s.blocked) ?? this._path[0];
		const pipeSpeed = Math.min(MAX_VIS_SPEED, (firstSeg?.v ?? 0) * BASE_SPEED) * this._rampF;

		const spawnPos = this._path[1]?.cumStart ?? 0;
		if (this._running && pipeSpeed > 0.5) {
			this._spawnTimer -= dt;
			if (this._spawnTimer <= 0) {
				this._particles.push({ pos: spawnPos, alpha: 0, dying: false });
				this._spawnTimer = Math.max(MIN_SPAWN_IVL, SPAWN_BASE_IVL / (pipeSpeed / BASE_SPEED));
			}
		}

		const alive = [];
		for (const p of this._particles) {
			const seg = this._segmentAt(p.pos);
			if (!seg) continue;

			const visSpeed = seg.blocked ? 0 : Math.min(MAX_VIS_SPEED, seg.v * BASE_SPEED) * this._rampF;
			const speedMulti = seg.negPressure ? 0.4 : 1.0;

			if (!p.dying) {
				p.pos += visSpeed * speedMulti * dt;
				if (p.pos >= this._totalLen) {
					p.pos = this._totalLen;
					p.dying = true;
				}
			}

			if (p.dying) {
				p.alpha = Math.max(0, p.alpha - FADE_RATE);
				if (p.alpha <= 0) continue;
			} else {
				p.alpha = Math.min(1, p.alpha + FADE_RATE);
			}

			alive.push(p);
			if (p.alpha < 0.02) continue;

			const svgPt = this._posToPoint(p.pos, seg);
			const { cx, cy } = this._getCanvasCoords(svgPt.x, svgPt.y);

			const a = (p.alpha * this._rampF * 0.7 + 0.15).toFixed(2);

			ctx.beginPath();
			ctx.arc(cx, cy, PARTICLE_R, 0, Math.PI * 2);
			ctx.fillStyle = seg.negPressure
				? `rgba(239,68,68,${a})`
				: fluidColor(parseFloat(a));
			ctx.fill();
		}
		this._particles = alive;
	}

	// </editor-fold>

	// <editor-fold desc="Path helpers">
	/**
	 * Returns the segment that contains the given path position (px from start).
	 * Linear scan — component count is typically < 20.
	 */
	_segmentAt(pos) {
		const segs = this._path;
		for (let i = segs.length - 1; i >= 0; i--) {
			if (pos >= segs[i].cumStart) return segs[i];
		}
		return segs[0] ?? null;
	}

	/**
	 * Converts a path position (px from start) to an SVG {x, y} point.
	 * Elbow segments: quadratic Bézier interpolation.
	 * All others: linear interpolation.
	 */
	_posToPoint(pos, seg) {
		const t = seg.lenPx > 0
			? Math.min(1, Math.max(0, (pos - seg.cumStart) / seg.lenPx))
			: 0;

		if (seg.isBezier) {
			return quadBezier(seg.x1, seg.y1, seg.cx, seg.cy, seg.x2, seg.y2, t);
		}
		return {
			x: seg.x1 + (seg.x2 - seg.x1) * t,
			y: seg.y1 + (seg.y2 - seg.y1) * t,
		};
	}
	// </editor-fold>

	// <editor-fold desc="Pump blade animation">

	_stepPump(dt) {
		if (!this._pumpCenter) return;

		const state = this._pumpState ?? 'STOPPED';
		const ramp = this._rampF ?? 0;
		const maxOmega = PUMP_RPM_DEG_S * Math.PI / 180;
		const targetOmega = maxOmega * ramp;

		if (state === 'STOPPED' || state === 'OVERLOAD') {
			this._pumpOmega = Math.max(0, this._pumpOmega - INERTIA_DECAY * dt);
		} else {
			this._pumpOmega += (targetOmega - this._pumpOmega) * Math.min(1, dt * 3);
		}

		this._pumpAngle += this._pumpOmega * dt;

		const { cx, cy } = this._getCanvasCoords(this._pumpCenter.cx, this._pumpCenter.cy);

		const isOverload = state === 'OVERLOAD';
		const alpha = 0.55 + ramp * 0.35;
		const color = isOverload ? `rgba(255,120,80,${alpha})` : fluidColor(alpha);

		const ctx = this._ctx;
		ctx.save();
		ctx.strokeStyle = color;
		ctx.lineWidth = BLADE_WIDTH;
		ctx.lineCap = 'round';

		for (let i = 0; i < BLADE_COUNT; i++) {
			const angle = this._pumpAngle + (i * Math.PI * 2) / BLADE_COUNT;
			ctx.beginPath();
			ctx.moveTo(cx + Math.cos(angle) * PUMP_R * 0.25, cy + Math.sin(angle) * PUMP_R * 0.25);
			ctx.lineTo(cx + Math.cos(angle) * PUMP_R * 0.82, cy + Math.sin(angle) * PUMP_R * 0.82);
			ctx.stroke();
		}

		ctx.beginPath();
		ctx.arc(cx, cy, 1.8, 0, Math.PI * 2);
		ctx.fillStyle = color;
		ctx.fill();
		ctx.restore();
	}
	// </editor-fold>
}