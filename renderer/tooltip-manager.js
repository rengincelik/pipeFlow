'use strict';

// TOOLTIP MANAGER
// SVG eleman hover'ında anlık hydraulic veri gösterimi.
// Engine ve renderer'a dokunmaz.

import { Units } from '../data/unit-system.js';

// TT5: Her g.component elementine bind edilmiş listener'ları takip et
const _boundMap = new WeakMap();

export class TooltipManager {
	constructor(svgEl, engine, pipelineStore, diagnosticEngine = null) {
		this._svg    = svgEl;
		this._engine = engine;
		this._store  = pipelineStore;
		this._el     = this._createEl();
		this._hideTimer = null;
		this._diagnosticEngine = diagnosticEngine;

		document.body.appendChild(this._el);
	}

	// ── Tooltip DOM elementi ───────────────────────────────────
	// R2/TT1: inline style.cssText → CSS class (flow-tooltip)
	// Stil tanımı style.css'te .flow-tooltip sınıfında
	_createEl() {
		const el = document.createElement('div');
		el.id = 'flow-tooltip';
		el.className = 'flow-tooltip';
		return el;
	}

	// ── Listener bağlama ───────────────────────────────────────
	// TT5: Bind öncesinde mevcut listener'ları temizle — WeakMap ile takip
	bind(svgRoot) {
		svgRoot.querySelectorAll('g.component').forEach(g => {
			// Önceki listener'ları temizle
			const prev = _boundMap.get(g);
			if (prev) {
				g.removeEventListener('mouseenter', prev.enter);
				g.removeEventListener('mousemove',  prev.move);
				g.removeEventListener('mouseleave', prev.leave);
			}

			// Yeni listener'lar
			const handlers = {
				enter: (e) => this._onEnter(e, g),
				move:  (e) => this._onMove(e),
				leave: ()  => this._onLeave(),
			};

			g.addEventListener('mouseenter', handlers.enter);
			g.addEventListener('mousemove',  handlers.move);
			g.addEventListener('mouseleave', handlers.leave);

			_boundMap.set(g, handlers);
		});
	}

	rebind(svgRoot) { this.bind(svgRoot); }

	// ── Event handlers ─────────────────────────────────────────
	_onEnter(e, g) {
		clearTimeout(this._hideTimer);
		const idClass = [...g.classList].find(c => c.startsWith('id-'));
		if (!idClass) return;
		const compId  = parseInt(idClass.replace('id-', ''));
		const content = this._buildContent(compId);
		if (!content) return;
		this._el.innerHTML = content;
		this._show(e.clientX, e.clientY);
	}

	_onMove(e)  { this._reposition(e.clientX, e.clientY); }
	_onLeave()  { this._hideTimer = setTimeout(() => this._hide(), 80); }

	// ── Güvenli değer — NaN/null/undefined → '—' ──────────────
	_fmt(val, fn) {
		if (val == null || !isFinite(val)) return '—';
		return fn(val);
	}

	// ── İçerik oluştur ─────────────────────────────────────────
	_buildContent(compId) {
		const comp = this._store.components.find(c => c.id === compId);
		if (!comp) return null;

		const snapshot = this._engine.lastSnapshot;
		const node     = snapshot?.nodes?.find(n => n.id === compId);

		// Engine çalışmıyor — sadece başlık
		if (!node) {
			return `
        <div style="color:#6b7280;font-size:10px;margin-bottom:4px;">ENGINE NOT RUNNING</div>
        <div style="color:#e2e8f0;font-weight:600;">${comp.name || comp.type}</div>`;
		}

		// ── Formatlı değerler ──────────────────────────────────
		const P_in  = this._fmt(node.P_in,      v => Units.pressure(v / 1e5));
		const P_out = this._fmt(node.P_out,     v => Units.pressure(v / 1e5));
		const vel   = this._fmt(node.v,         v => Units.velocity(v));
		const Q     = this._fmt(snapshot.Q_m3s, v => Units.flow(v * 1000 * 60));
		const Re    = this._fmt(node.Re,        v => Math.round(v).toLocaleString());
		const dPmaj = this._fmt(node.dP_major,  v => Units.pressure(v / 1e5, 4));
		const dPmin = this._fmt(node.dP_minor,  v => Units.pressure(v / 1e5, 4));

		const regime = (isFinite(node.Re) && node.Re > 0) ? this._regime(node.Re) : '—';
		const state  = node.nodeState ?? '—';

		// ── Eleman tipine göre ekstra satırlar ─────────────────
		let extra = '';

		if (comp.type === 'valve') {
			const pct = this._fmt(node.opening, v => `${(v * 100).toFixed(0)}%`);
			const K   = this._fmt(node.K,       v => v.toFixed(2));
			extra = this._row('Opening', pct) + this._row('K', K);
		}

		if (comp.type === 'pipe') {
			const f = this._fmt(node.f, v => v.toFixed(4));
			extra = this._row('f (friction)', f);
		}

		if (comp.type === 'transition') {
			const D_in  = this._fmt(comp.d_in_mm,  v => Units.diameter(v));
			const D_out = this._fmt(comp.d_out_mm, v => Units.diameter(v));
			extra = this._row('D in', D_in) + this._row('D out', D_out);
		}

		if (comp.type === 'pump') {
			// TT2: comp.resolve('head_m') — doğru prop adı
			const headVal = comp.resolve('head_m');
			const H = this._fmt(headVal, v => `${v} m`);
			extra = this._row('Nom. Head', H);
		}

		if (comp.type === 'elbow') {
			// TT3: comp.resolve('K') — override mixin üzerinden
			const K = this._fmt(comp.resolve('K'), v => v.toFixed(2));
			extra = this._row('K', K);
		}

		const diagResults = this._diagnosticEngine?.getResultsFor(compId) ?? [];
		const diagSection = diagResults.length ? this._buildDiagSection(diagResults) : '';

		return `
		  <div style="color:#94a3b8;font-size:10px;margin-bottom:6px;letter-spacing:0.05em;">
			${comp.type.toUpperCase()}${comp.subtype ? ' · ' + comp.subtype : ''}
		  </div>
		  <div style="color:#f1f5f9;font-weight:600;font-size:12px;margin-bottom:8px;">
			${comp.name || comp.type}
		  </div>
		  <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:7px;">
			${this._row('P in',   P_in)}
			${this._row('P out',  P_out)}
			${this._row('v',      vel)}
			${this._row('Q',      Q)}
			${this._row('Re',     `${(node.Re > 0) ? this._row('Re', `${Re} · ${regime}`) : ''}`)}
			${this._row('ΔP maj', dPmaj, '#f87171')}
			${this._row('ΔP min', dPmin, '#fbbf24')}
			${extra}
			${this._row('State',  state, this._stateColor(state))}
		  </div>
		  ${diagSection}`;

	}

	// ── Yardımcılar ────────────────────────────────────────────
	_row(label, value, color = '#e2e8f0') {
		return `
      <div style="display:flex;justify-content:space-between;gap:16px;">
        <span style="color:#6b7280">${label}</span>
        <span style="color:${color};font-variant-numeric:tabular-nums">${value}</span>
      </div>`;
	}

	_regime(Re) {
		if (Re < 2300) return 'Laminar';
		if (Re < 4000) return 'Trans.';
		return 'Turbulent';
	}

	_stateColor(state) {
		return {
			flowing: '#34d399',
			blocked: '#f87171',
			dry:     '#6b7280',
			filling: '#fbbf24',
		}[state] ?? '#e2e8f0';
	}

	// ── Pozisyon ───────────────────────────────────────────────
	_show(x, y) {
		this._reposition(x, y);
		this._el.style.opacity = '1';
	}

	_hide() {
		this._el.style.opacity = '0';
	}

	_reposition(x, y) {
		const tw = this._el.offsetWidth  || 180;
		const th = this._el.offsetHeight || 200;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const offset = 14;
		let left = x + offset;
		let top  = y + offset;
		if (left + tw > vw - 8) left = x - tw - offset;
		if (top  + th > vh - 8) top  = y - th - offset;
		this._el.style.left = left + 'px';
		this._el.style.top  = top  + 'px';
	}

	destroy() { this._el.remove(); }
	_buildDiagSection(results) {
		const COLORS = { critical: '#f87171', warning: '#fbbf24', info: '#94a3b8' };
		const rows = results.map(r => {
			const color = COLORS[r.severity] ?? '#94a3b8';
			return `<div style="display:flex;gap:6px;align-items:baseline;padding:2px 0;">
      <span style="color:${color};font-size:9px;font-family:var(--font-mono);white-space:nowrap;">${r.id}</span>
      <span style="color:#cbd5e1;font-size:10px;">${r.message}</span>
    </div>`;
		}).join('');

		return `
    <div style="border-top:1px solid rgba(255,255,255,0.06);margin-top:6px;padding-top:6px;">
      <div style="color:#64748b;font-size:9px;letter-spacing:0.05em;margin-bottom:3px;">DIAGNOSTICS</div>
      ${rows}
    </div>`;
	}
}