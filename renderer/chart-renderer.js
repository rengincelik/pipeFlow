'use strict';

// CHART RENDERER v2
// Sol panel: Stacked bar — anlık kayıp/hız/basınç dağılımı (eleman bazlı)
// Sağ panel: Zaman çizgisi — son 60s kayan pencere
// Metrik: 'dP' | 'pressure' | 'velocity' | 'flow'
// Buffer: son 600 snapshot (100ms tick × 600 = 60s) — ChartRenderer içinde tutulur
// CSS token'ları runtime'da okunur — light/dark tema otomatik

import { Units } from '../data/unit-system.js';

// ── Sabitler ────────────────────────────────────────────────────────────────

const BUFFER_SIZE = 600;   // 60 saniye @ 100ms tick

const SPLIT      = 0.38;   // sol panel genişlik oranı
const GAP        = 1;      // iki panel arası boşluk (px)

const PAD = { top: 28, right: 14, bottom: 48, left: 48 };
// Sağ panel için ayrı left padding (eksen etiketi için)
const PAD_R = { top: 28, right: 14, bottom: 48, left: 44 };

const FONT_SM  = "9px 'IBM Plex Mono', monospace";
const FONT_XS  = "8px 'IBM Plex Mono', monospace";
const FONT_LBL = "10px 'IBM Plex Mono', monospace";

// Eleman tipi → CSS token adı
const TYPE_TOKEN = {
	pump:       '--c-pump',
	pipe:       '--c-pipe',
	valve:      '--c-valve',
	transition: '--c-trans',
	elbow:      '--c-elbow',
	prv:        '--c-prv',
};

// Metrik tanımları
const METRICS = {
	dP:       { label: 'ΔP',       unit: 'bar' },
	pressure: { label: 'Pressure', unit: 'bar' },
	velocity: { label: 'Velocity', unit: 'm/s' },
	flow:     { label: 'Flow',     unit: 'L/min' },
};

// ── Yardımcı ────────────────────────────────────────────────────────────────

function cssVar(name) {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function compColor(type, subtype) {
	const token = (type === 'valve' && subtype === 'prv') ? '--c-prv' : (TYPE_TOKEN[type] ?? '--c-pipe');
	return cssVar(token);
}

function hexToRgba(hex, alpha) {
	// CSS token'ı zaten rgb/rgba ise direkt döndür, hex ise dönüştür
	if (!hex) return `rgba(100,120,160,${alpha})`;
	const c = hex.trim();
	if (c.startsWith('rgba') || c.startsWith('rgb')) {
		// alpha override
		return c.replace(/rgba?\(([^)]+)\)/, (_, inner) => {
			const parts = inner.split(',').map(s => s.trim());
			if (parts.length >= 3) return `rgba(${parts[0]},${parts[1]},${parts[2]},${alpha})`;
			return `rgba(${inner},${alpha})`;
		});
	}
	// hex → rgba
	let h = c.replace('#', '');
	if (h.length === 3) h = h.split('').map(x => x + x).join('');
	const num = parseInt(h, 16);
	const r = (num >> 16) & 255;
	const g = (num >> 8)  & 255;
	const b = num & 255;
	return `rgba(${r},${g},${b},${alpha})`;
}

// ── Sınıf ────────────────────────────────────────────────────────────────────

export class ChartRenderer {
	constructor(canvas) {
		this.canvas = canvas;
		this.ctx    = canvas.getContext('2d');

		this.emptyPlaceholder = document.getElementById('chart-empty');

		this._metric  = 'dP';       // aktif metrik
		this._buffer  = [];         // { ts, nodes, components } dizisi — max BUFFER_SIZE
		this._lastData = null;

		this._ro = new ResizeObserver(() => this._resize());
		this._ro.observe(canvas.parentElement);
		this._resize();
	}

	// ── Public API ─────────────────────────────────────────────────────────────

	setMetric(metric) {
		if (!(metric in METRICS)) return;
		this._metric = metric;
		if (this._lastData) this.draw(this._lastData);
	}

	/**
	 * Ana çizim — main.js signature DEĞİŞMEDİ
	 * @param {{ results, components, selectedIdx }} data
	 *   results[i] = { P_in, P_out, v, dP_major, dP_minor, Q_m3s? }  (bar/m/s)
	 */
	draw(data) {
		this._lastData = data;

		// Buffer'a ekle
		if (data.results && data.results.length) {
			this._buffer.push({
				ts:         Date.now(),
				nodes:      data.results,
				components: data.components,
			});
			if (this._buffer.length > BUFFER_SIZE) this._buffer.shift();
		}

		const hasData = data.results && data.results.length > 0;

		if (this.emptyPlaceholder) {
			this.emptyPlaceholder.style.display = hasData ? 'none' : 'flex';
		}

		const ctx = this.ctx;
		const W = this._cw, H = this._ch;

		// Arka plan
		ctx.clearRect(0, 0, W, H);
		ctx.fillStyle = cssVar('--bg-surface');
		ctx.fillRect(0, 0, W, H);

		if (!hasData) return;

		const leftW  = Math.floor(W * SPLIT);
		const rightX = leftW + GAP;
		const rightW = W - rightX;

		// Clip + çiz
		ctx.save();
		ctx.beginPath(); ctx.rect(0, 0, leftW, H); ctx.clip();
		this._drawStackedBar(ctx, data, 0, leftW, H);
		ctx.restore();

		// Dikey ayırıcı
		ctx.fillStyle = cssVar('--border-mid');
		ctx.fillRect(leftW, 0, GAP, H);

		ctx.save();
		ctx.beginPath(); ctx.rect(rightX, 0, rightW, H); ctx.clip();
		this._drawTimeline(ctx, rightX, rightW, H);
		ctx.restore();
	}

	clear() {
		this._lastData = null;
		this._buffer   = [];
		const ctx = this.ctx;
		ctx.clearRect(0, 0, this._cw, this._ch);
		ctx.fillStyle = cssVar('--bg-surface');
		ctx.fillRect(0, 0, this._cw, this._ch);
	}

	destroy() { this._ro.disconnect(); }

	// ── Resize ─────────────────────────────────────────────────────────────────

	_resize() {
		const parent = this.canvas.parentElement;
		const dpr    = window.devicePixelRatio || 1;
		const w      = parent.clientWidth;
		const h      = parent.clientHeight;
		this.canvas.width  = w * dpr;
		this.canvas.height = h * dpr;
		this.canvas.style.width  = w + 'px';
		this.canvas.style.height = h + 'px';
		this.ctx.scale(dpr, dpr);
		this._cw = w;
		this._ch = h;
		if (this._lastData) this.draw(this._lastData);
	}

	// ── Sol Panel: Tek Sütun Stacked Bar ──────────────────────────────────────
	// Tüm elemanlar tek bar içinde üst üste renkli dilimler

	_drawStackedBar(ctx, data, ox, W, H) {
		const { results, components, selectedIdx } = data;
		const metric = this._metric;

		const pl = PAD.left, pr = PAD.right, pt = PAD.top, pb = PAD.bottom;
		const gh = H - pt - pb;

		const cGrid = cssVar('--border');
		const cAxis = cssVar('--border-hi');
		const cText = cssVar('--text-dim');

		// Değerleri çıkar
		const values = results.map((r, i) => this._metricValue(r, i, components, metric));
		const validValues = values.filter(isFinite).filter(v => v >= 0);

		// Toplam & scale
		const total  = validValues.reduce((s, v) => s + v, 0);
		const maxVal = Math.max(1e-6, total) * 1.1;

		// Sabit bar genişliği — sol panelin ortasında
		const barW = Math.min(64, (W - pl - pr) * 0.55);
		const barX = ox + pl + (W - pl - pr) / 2 - barW / 2;

		// Panel başlığı
		ctx.fillStyle = cText;
		ctx.font      = FONT_SM;
		ctx.textAlign = 'center';
		ctx.fillText(METRICS[metric].label + ' distribution', ox + W / 2, pt - 12);

		// Grid yatay çizgiler
		ctx.strokeStyle = cGrid;
		ctx.lineWidth   = 1;
		for (let i = 0; i <= 4; i++) {
			const y = pt + (gh / 4) * i;
			ctx.beginPath();
			ctx.moveTo(ox + PAD.left, y);
			ctx.lineTo(ox + W - PAD.right, y);
			ctx.stroke();
		}

		// Sol eksen
		ctx.strokeStyle = cAxis;
		ctx.lineWidth   = 1;
		ctx.beginPath();
		ctx.moveTo(ox + PAD.left, pt);
		ctx.lineTo(ox + PAD.left, pt + gh);
		ctx.moveTo(ox + PAD.left, pt + gh);
		ctx.lineTo(ox + W - PAD.right, pt + gh);
		ctx.stroke();

		// Y eksen etiketleri
		ctx.fillStyle = cText;
		ctx.font      = FONT_SM;
		ctx.textAlign = 'right';
		for (let i = 0; i <= 4; i++) {
			const val = maxVal * (1 - i / 4);
			const y   = pt + (gh / 4) * i;
			ctx.fillText(this._fmtAxisVal(val, metric), ox + PAD.left - 4, y + 3);
		}

		// Birim etiketi
		ctx.fillStyle = cText;
		ctx.font      = FONT_XS;
		ctx.textAlign = 'left';
		ctx.fillText('[' + this._metricUnit(metric) + ']', ox + PAD.left + 2, pt - 6);

		// Bar arka planı (tam yükseklik, soluk)
		ctx.fillStyle = cssVar('--bg-raised');
		ctx.fillRect(barX, pt, barW, gh);

		// Stacked dilimler — alttan yukarı
		let curY = pt + gh;  // çizim yukarı doğru gider

		components.forEach((comp, i) => {
			const val = values[i];
			if (!isFinite(val) || val <= 0) return;

			const sliceH    = Math.max(1, (val / maxVal) * gh);
			const sliceY    = curY - sliceH;
			const color     = compColor(comp.type, comp.subtype);
			const isSelected = selectedIdx === i;

			// Dilim dolgusu
			const grad = ctx.createLinearGradient(barX, sliceY, barX + barW, sliceY);
			grad.addColorStop(0, hexToRgba(color, isSelected ? 1.0 : 0.75));
			grad.addColorStop(1, hexToRgba(color, isSelected ? 0.85 : 0.55));
			ctx.fillStyle = grad;
			ctx.fillRect(barX, sliceY, barW, sliceH);

			// Dilim üst sınır çizgisi (ayırıcı)
			if (i > 0) {
				ctx.strokeStyle = cssVar('--bg-surface');
				ctx.lineWidth   = 1.5;
				ctx.beginPath();
				ctx.moveTo(barX, sliceY);
				ctx.lineTo(barX + barW, sliceY);
				ctx.stroke();
			}

			// Seçili vurgu — sol kenar çizgisi
			if (isSelected) {
				ctx.strokeStyle = color;
				ctx.lineWidth   = 2;
				ctx.beginPath();
				ctx.moveTo(barX - 1, sliceY);
				ctx.lineTo(barX - 1, sliceY + sliceH);
				ctx.stroke();
			}

			// Dilim içi etiket — yeterince yüksekse göster
			if (sliceH >= 16) {
				const pct = total > 0 ? ((val / total) * 100).toFixed(0) + '%' : '';
				ctx.fillStyle = 'rgba(255,255,255,0.85)';
				ctx.font      = FONT_XS;
				ctx.textAlign = 'center';
				ctx.fillText(pct, barX + barW / 2, sliceY + sliceH / 2 + 3);
			}

			curY = sliceY;
		});

		// Bar dış çerçeve
		ctx.strokeStyle = cAxis;
		ctx.lineWidth   = 1;
		ctx.strokeRect(barX, pt, barW, gh);

		// Toplam değer — bar üstünde
		ctx.fillStyle = cssVar('--text-mid');
		ctx.font      = FONT_SM;
		ctx.textAlign = 'center';
		ctx.fillText(this._fmtBarVal(total, metric), barX + barW / 2, pt - 2);

		// ── Legend — bar sağında eleman listesi ───────────────────────────────
		const legendX = barX + barW + 10;
		const legendMaxW = ox + W - PAD.right - legendX;

		if (legendMaxW > 30) {
			let legendY = pt + 8;
			const lineH = Math.min(18, gh / Math.max(1, components.length));

			components.forEach((comp, i) => {
				const val   = values[i];
				const color = compColor(comp.type, comp.subtype);
				const pct   = (isFinite(val) && total > 0) ? ((val / total) * 100).toFixed(0) + '%' : '—';
				const isSelected = selectedIdx === i;

				// Renk kutusu
				ctx.fillStyle = hexToRgba(color, isSelected ? 1 : 0.75);
				ctx.fillRect(legendX, legendY - 6, 8, 8);

				// Eleman adı + yüzde
				ctx.fillStyle = isSelected ? cssVar('--text') : cText;
				ctx.font      = isSelected ? `bold ${FONT_XS}` : FONT_XS;
				ctx.textAlign = 'left';
				const lbl = this._compLabel(comp);
				ctx.fillText(`${lbl} ${pct}`, legendX + 12, legendY);

				legendY += lineH;
			});
		}
	}

	// ── Sağ Panel: Zaman Çizgisi ───────────────────────────────────────────────

	_drawTimeline(ctx, ox, W, H) {
		if (this._buffer.length < 2) {
			// Yeterli veri yok
			ctx.fillStyle = cssVar('--text-dim');
			ctx.font      = FONT_SM;
			ctx.textAlign = 'center';
			ctx.fillText('Waiting for data...', ox + W / 2, H / 2);
			return;
		}

		const metric = this._metric;
		const pl = PAD_R.left, pr = PAD_R.right, pt = PAD_R.top, pb = PAD_R.bottom;
		const gw = W - pl - pr;
		const gh = H - pt - pb;

		const cGrid = cssVar('--border');
		const cAxis = cssVar('--border-hi');
		const cText = cssVar('--text-dim');

		// Zaman penceresi
		const now      = this._buffer.at(-1).ts;
		const windowMs = 60_000;
		const tMin     = now - windowMs;

		// Görünür buffer
		const visible = this._buffer.filter(s => s.ts >= tMin);
		if (visible.length < 2) return;

		// Tüm değerleri topla — scale için
		const allVals = visible.flatMap(snap =>
			snap.nodes.map((r, i) => this._metricValue(r, i, snap.components, metric))
		).filter(isFinite);

		let yMin = 0;
		let yMax = Math.max(1e-6, ...allVals) * 1.15;

		if (metric === 'pressure') {
			yMin = Math.min(0, ...allVals);
			yMax = Math.max(0.1, ...allVals) * 1.15;
		}

		const toX = ts => ox + pl + ((ts - tMin) / windowMs) * gw;
		const toY = v  => pt + gh - ((v - yMin) / (yMax - yMin)) * gh;

		// Arka plan
		ctx.fillStyle = cssVar('--bg-surface');
		ctx.fillRect(ox, 0, W, H);

		// Panel başlığı
		ctx.fillStyle = cText;
		ctx.font      = FONT_SM;
		ctx.textAlign = 'center';
		ctx.fillText('60s trend — ' + METRICS[metric].label, ox + W / 2, pt - 12);

		// Grid
		ctx.strokeStyle = cGrid;
		ctx.lineWidth   = 1;
		for (let i = 0; i <= 4; i++) {
			const y = pt + (gh / 4) * i;
			ctx.beginPath();
			ctx.moveTo(ox + pl, y);
			ctx.lineTo(ox + pl + gw, y);
			ctx.stroke();
		}
		// Dikey grid (10s aralıklarla)
		for (let s = 0; s <= 60; s += 10) {
			const x = ox + pl + (s / 60) * gw;
			ctx.beginPath();
			ctx.moveTo(x, pt);
			ctx.lineTo(x, pt + gh);
			ctx.stroke();
		}

		// Eksenler
		ctx.strokeStyle = cAxis;
		ctx.lineWidth   = 1;
		ctx.beginPath();
		ctx.moveTo(ox + pl, pt);
		ctx.lineTo(ox + pl, pt + gh);
		ctx.moveTo(ox + pl, pt + gh);
		ctx.lineTo(ox + pl + gw, pt + gh);
		ctx.stroke();

		// Y eksen etiketleri
		ctx.fillStyle = cText;
		ctx.font      = FONT_SM;
		ctx.textAlign = 'right';
		for (let i = 0; i <= 4; i++) {
			const val = yMin + (yMax - yMin) * (1 - i / 4);
			const y   = pt + (gh / 4) * i;
			ctx.fillText(this._fmtAxisVal(val, metric), ox + pl - 4, y + 3);
		}

		// X eksen zaman etiketleri
		ctx.textAlign = 'center';
		for (let s = 0; s <= 60; s += 10) {
			const x     = ox + pl + (s / 60) * gw;
			const label = s === 60 ? 'now' : `-${60 - s}s`;
			ctx.fillText(label, x, pt + gh + 13);
		}

		// Birim etiketi
		ctx.fillStyle = cText;
		ctx.font      = FONT_XS;
		ctx.textAlign = 'left';
		ctx.fillText('[' + this._metricUnit(metric) + ']', ox + pl + 2, pt - 6);

		// Sıfır çizgisi (pressure modunda)
		if (metric === 'pressure' && yMin < 0) {
			const y0 = toY(0);
			ctx.strokeStyle = hexToRgba(cssVar('--red'), 0.3);
			ctx.setLineDash([4, 4]);
			ctx.beginPath();
			ctx.moveTo(ox + pl, y0);
			ctx.lineTo(ox + pl + gw, y0);
			ctx.stroke();
			ctx.setLineDash([]);
		}

		// Her eleman için çizgi — components'ı son snapshot'tan al
		const lastComponents = visible.at(-1).components;

		lastComponents.forEach((comp, compIdx) => {
			const color = compColor(comp.type, comp.subtype);

			// Bu eleman için zaman serisi
			const points = visible
				.map(snap => {
					if (!snap.nodes[compIdx]) return null;
					const val = this._metricValue(snap.nodes[compIdx], compIdx, snap.components, metric);
					if (!isFinite(val)) return null;
					return { x: toX(snap.ts), y: toY(val) };
				})
				.filter(Boolean);

			if (points.length < 2) return;

			// Alan dolgusu
			ctx.save();
			ctx.beginPath();
			ctx.moveTo(points[0].x, points[0].y);
			points.forEach(p => ctx.lineTo(p.x, p.y));
			ctx.lineTo(points.at(-1).x, pt + gh);
			ctx.lineTo(points[0].x, pt + gh);
			ctx.closePath();
			ctx.fillStyle = hexToRgba(color, 0.06);
			ctx.fill();
			ctx.restore();

			// Çizgi
			ctx.strokeStyle = hexToRgba(color, 0.8);
			ctx.lineWidth   = 1.5;
			ctx.lineJoin    = 'round';
			ctx.setLineDash([]);
			ctx.beginPath();
			ctx.moveTo(points[0].x, points[0].y);
			points.forEach(p => ctx.lineTo(p.x, p.y));
			ctx.stroke();

			// Son nokta
			const last = points.at(-1);
			ctx.fillStyle = hexToRgba(color, 1);
			ctx.beginPath();
			ctx.arc(last.x, last.y, 2.5, 0, Math.PI * 2);
			ctx.fill();
		});

		// Sağ kenar "şimdi" etiketi — son değerler
		ctx.font      = FONT_XS;
		ctx.textAlign = 'left';
		const lastSnap = visible.at(-1);
		lastComponents.forEach((comp, compIdx) => {
			if (!lastSnap.nodes[compIdx]) return;
			const val = this._metricValue(lastSnap.nodes[compIdx], compIdx, lastSnap.components, metric);
			if (!isFinite(val)) return;
			const color = compColor(comp.type, comp.subtype);
			const y     = toY(val);
			// Yalnızca görünür alanda
			if (y < pt + 6 || y > pt + gh - 4) return;
			ctx.fillStyle = hexToRgba(color, 0.9);
			ctx.fillText(this._fmtBarVal(val, metric), ox + pl + gw + 3, y + 3);
		});
	}

	// ── Metrik Hesabı ──────────────────────────────────────────────────────────
	// Değerler SI'dan alınır, Units dönüşümü burada yapılır — görüntüleme katmanı

	_metricValue(node, idx, components, metric) {
		switch (metric) {
			case 'dP':
				return Units.pressureVal((node.dP_major ?? 0) + (node.dP_minor ?? 0));
			case 'pressure':
				return Units.pressureVal(node.P_out ?? 0);
			case 'velocity':
				return Units.velocityVal(node.v ?? 0);
			case 'flow': {
				const Q_lpm = (node.Q_m3s ?? 0) * 1000 * 60;  // m3/s -> L/min
				return Units.flowVal(Q_lpm);
			}
			default:
				return 0;
		}
	}

	_metricUnit(metric) {
		switch (metric) {
			case 'dP':
			case 'pressure': return Units.isMetric ? 'bar' : 'psi';
			case 'velocity': return Units.isMetric ? 'm/s' : 'ft/s';
			case 'flow':     return Units.isMetric ? 'L/min' : 'GPM';
			default:         return '';
		}
	}

	_fmtAxisVal(val, metric) {
		if (!isFinite(val)) return '-';
		switch (metric) {
			case 'dP':
			case 'pressure': return val.toFixed(2);
			case 'velocity': return val.toFixed(1);
			case 'flow':     return val.toFixed(0);
			default:         return val.toFixed(2);
		}
	}

	_fmtBarVal(val, metric) {
		if (!isFinite(val)) return '-';
		switch (metric) {
			case 'dP':
			case 'pressure': return val.toFixed(3);
			case 'velocity': return val.toFixed(2);
			case 'flow':     return val.toFixed(1);
			default:         return val.toFixed(2);
		}
	}

	_compLabel(comp) {
		const map = {
			pump: 'PMP', pipe: 'PIP', valve: 'VLV',
			transition: 'TRN', elbow: 'ELB', prv: 'PRV',
		};
		if (comp.type === 'valve' && comp.subtype === 'prv') return 'PRV';
		return map[comp.type] ?? comp.type.slice(0, 3).toUpperCase();
	}
}