'use strict';

// TOOLTIP MANAGER
// SVG eleman hover'ında anlık hydraulic veri gösterimi.
// Engine ve renderer'a dokunmaz.

import { Units } from '../data/unit-system.js';

export class TooltipManager {
  /**
   * @param {SVGSVGElement} svgEl       — event koordinatları için
   * @param {object}        engine      — lastSnapshot için
   * @param {object}        pipelineStore
   */
  constructor(svgEl, engine, pipelineStore) {
    this._svg   = svgEl;
    this._engine = engine;
    this._store  = pipelineStore;
    this._el     = this._createEl();
    this._hideTimer = null;
    document.body.appendChild(this._el);
  }

  // ── Tooltip DOM elementi ────────────────────────────────────
  _createEl() {
    const el = document.createElement('div');
    el.id = 'flow-tooltip';
    el.style.cssText = `
      position: fixed;
      z-index: 9999;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.12s ease;
      background: #0e1117;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 6px;
      padding: 10px 13px;
      min-width: 160px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      font-family: 'IBM Plex Mono', monospace;
      font-size: 11px;
      line-height: 1.7;
      color: #c8cdd8;
    `;
    return el;
  }

  // ── SVG'deki tüm component group'larına listener bağla ─────
  bind(svgRoot) {
    // Mevcut listener'ları temizle
    svgRoot.querySelectorAll('g.component').forEach(g => {
      g.addEventListener('mouseenter', e => this._onEnter(e, g));
      g.addEventListener('mousemove',  e => this._onMove(e));
      g.addEventListener('mouseleave', () => this._onLeave());
    });
  }

  // ── Yeni render sonrası yeniden bağla ──────────────────────
  rebind(svgRoot) {
    this.bind(svgRoot);
  }

  // ── Event handlers ─────────────────────────────────────────
  _onEnter(e, g) {
    clearTimeout(this._hideTimer);

    // Component id'yi class listesinden çıkar: id-{n}
    const idClass = [...g.classList].find(c => c.startsWith('id-'));
    if (!idClass) return;
    const compId = parseInt(idClass.replace('id-', ''));

    const content = this._buildContent(compId);
    if (!content) return;

    this._el.innerHTML = content;
    this._show(e.clientX, e.clientY);
  }

  _onMove(e) {
    this._reposition(e.clientX, e.clientY);
  }

  _onLeave() {
    this._hideTimer = setTimeout(() => this._hide(), 80);
  }

  // ── İçerik oluştur ─────────────────────────────────────────
  _buildContent(compId) {
    const comp     = this._store.components.find(c => c.id === compId);
    if (!comp) return null;

    const snapshot = this._engine.lastSnapshot;
    const node     = snapshot?.nodes?.find(n => n.id === compId);

    // Engine çalışmıyorsa sadece başlık göster
    if (!node) {
      return `<div style="color:#6b7280;font-size:10px;">ENGINE NOT RUNNING</div>
              <div style="color:#e2e8f0;font-weight:600;margin-bottom:4px;">
                ${comp.name || comp.type}
              </div>`;
    }

    const Q_lpm   = Units.flow(snapshot.Q_m3s * 1000 * 60);

    const P_in  = Units.pressure(node.P_in  / 1e5);
    const P_out = Units.pressure(node.P_out / 1e5);
    const v     = Units.velocity(node.v);

    const Re      = node.Re ? Math.round(node.Re).toLocaleString() : '—';
    const dPmaj   = (node.dP_major / 1e5).toFixed(4);
    const dPmin   = (node.dP_minor / 1e5).toFixed(4);
    const regime  = this._regime(node.Re);
    const state   = node.nodeState ?? '—';

    // Eleman tipine göre ekstra satır
    let extra = '';
    if (comp.type === 'valve') {
      const pct = ((node.opening ?? 1) * 100).toFixed(0);
      const K   = node.K?.toFixed(2) ?? '—';
      extra = this._row('Opening', `${pct}%`) + this._row('K', K);
    }
    if (comp.type === 'pipe' && node.f) {
      extra = this._row('f', node.f.toFixed(4));
    }

    return `
      <div style="color:#94a3b8;font-size:10px;margin-bottom:6px;letter-spacing:0.05em;">
        ${comp.type.toUpperCase()} · ${comp.subtype ?? ''}
      </div>
      <div style="color:#f1f5f9;font-weight:600;font-size:12px;margin-bottom:8px;">
        ${comp.name || comp.type}
      </div>
      <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:7px;">
        ${this._row('P in',    P_in  + ' bar')}
        ${this._row('P out',   P_out + ' bar')}
        ${this._row('v',       v     + ' m/s')}
        ${this._row('Q',       Q_lpm + ' L/min')}
        ${this._row('Re',      Re + ' · ' + regime)}
        ${this._row('ΔP maj',  dPmaj + ' bar', '#f87171')}
        ${this._row('ΔP min',  dPmin + ' bar', '#fbbf24')}
        ${extra}
        ${this._row('State',   state, this._stateColor(state))}
      </div>
    `;
  }

  _row(label, value, color = '#e2e8f0') {
    return `
      <div style="display:flex;justify-content:space-between;gap:16px;">
        <span style="color:#6b7280">${label}</span>
        <span style="color:${color};font-variant-numeric:tabular-nums">${value}</span>
      </div>`;
  }

  _regime(Re) {
    if (!Re) return '—';
    if (Re < 2300) return 'Laminar';
    if (Re < 4000) return 'Trans.';
    return 'Turbulent';
  }

  _stateColor(state) {
    const map = {
      flowing: '#34d399',
      blocked: '#f87171',
      dry:     '#6b7280',
      filling: '#fbbf24',
    };
    return map[state] ?? '#e2e8f0';
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

    // Sağa taşarsa sola al
    if (left + tw > vw - 8) left = x - tw - offset;
    // Aşağı taşarsa yukarı al
    if (top  + th > vh - 8) top  = y - th - offset;

    this._el.style.left = left + 'px';
    this._el.style.top  = top  + 'px';
  }

  destroy() {
    this._el.remove();
  }
}
