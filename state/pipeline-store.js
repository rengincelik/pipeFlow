'use strict';

// ═══════════════════════════════════════════════════════════
// PIPELINE STORE — reaktif state, hesap koordinasyonu
// ═══════════════════════════════════════════════════════════

import { EventEmitter }   from '../core/event-emitter.js';
import { SystemConfig }   from './system-config.js';
import { fluidRegistry }  from '../core/fluid-model.js';
import { computeLayout }  from '../renderer/svg-renderer.js';

export class PipelineStore extends EventEmitter {
  constructor() {
    super();
    this._components = [];   // ComponentBase[]
    this._calcResults = [];  // her komp için P_in/P_out
    this._selectedId  = null;

    // SystemConfig değişince yeniden hesapla
    SystemConfig.on('change', () => this._recalc());
  }

  // ── Component CRUD ───────────────────────────────────────

  insert(comp, atIndex = this._components.length) {
    // Önceki komptan çap mirası
    if (atIndex > 0) {
      const prev = this._components[atIndex - 1];
      const prevD = prev.outDiameter_mm;
      if (comp.type !== 'pipe' && !comp.hasOverride('diameter_mm')) {
        comp.override('diameter_mm', prevD);
      }
    }
    this._components.splice(atIndex, 0, comp);

    // Override change → recalc + emit
    comp.on('override:change', () => this._recalc());

    this._recalc();
    this.emit('components:change');
    return this;
  }

  remove(compId) {
    const idx = this._components.findIndex(c => c.id === compId);
    if (idx === -1) return this;
    this._components.splice(idx, 1);
    if (this._selectedId === compId) this._selectedId = null;
    this._recalc();
    this.emit('components:change');
    return this;
  }

  clear() {
    this._components = [];
    this._calcResults = [];
    this._selectedId  = null;
    this.emit('components:change');
    return this;
  }

  get components() { return [...this._components]; }
  get length()     { return this._components.length; }

  // ── Seçim ────────────────────────────────────────────────

  select(compId) {
    this._selectedId = compId;
    this.emit('selection:change', compId);
    return this;
  }

  deselect() { return this.select(null); }

  get selectedId()   { return this._selectedId; }
  get selectedComp() {
    return this._components.find(c => c.id === this._selectedId) ?? null;
  }

  // ── Hesap ────────────────────────────────────────────────
  /** Public wrapper — dışarıdan zorla yeniden hesapla */
  recalc() { this._recalc(); }

  _recalc() {
    if (!this._components.length) {
      this._calcResults = [];
      this.lastResults = [];
      this.emit('calc:done', { results: [], P_out_final: 0, status: null });
      return;
    }

    const cfg    = SystemConfig.snapshot();
    const fluid  = fluidRegistry.get(cfg.fluid_id).getProps(cfg.T_in_C);
    const fluidP = { rho: fluid.rho, mu_mPas: fluid.mu_mPas };
    const Q_m3s  = cfg.Q_lpm / 60000;
    const N      = this._components.length;

    let P       = cfg.P_in_bar;
    let blocked = false;
    const results = [];

    for (let i = 0; i < N; i++) {
      const comp = this._components[i];
      const prev = i > 0 ? this._components[i - 1] : null;

      // Sıcaklık interpolasyonu (giriş → çıkış)
      const T_seg = cfg.T_in_C + (cfg.T_out_C - cfg.T_in_C) * ((i + 0.5) / N);
      const fp    = fluidRegistry.get(cfg.fluid_id).getProps(T_seg);
      const fl    = { rho: fp.rho, mu_mPas: fp.mu_mPas };

      const P_in = P;
      let P_out, dP_bar;

      if (blocked) {
        comp.result = { v: 0, Re: 0, blocked: true, dP_bar: 0, dP_Pa: 0, hf: { total: 0 } };
        P_out = 0;
        dP_bar = P_in;
      } else {
        const r = comp.calcHydraulics(Q_m3s, fl, prev);

        // PRV özel: P_out = min(P_in, P_set)
        if (r.isPRV) {
          P_out  = Math.min(P_in, comp.P_set_bar);
          dP_bar = P_in - P_out;
          r.dP_bar = dP_bar;
        } else if (r.blocked) {
          P_out  = 0;
          dP_bar = P_in;
          blocked = true;
        } else {
          dP_bar = r.dP_bar;
          P_out  = +(P_in - dP_bar).toFixed(5);
        }
      }

      comp.result.P_in  = +P_in.toFixed(4);
      comp.result.P_out = +P_out.toFixed(4);
      results.push(comp.result);
      P = P_out;
    }

    this._calcResults = results;

    // Sistem durumu
    const P_out_final = results[results.length - 1]?.P_out ?? 0;
    const status = this._evalStatus(P_out_final, results);

    this.lastResults = results;
    this.emit('calc:done', { results, P_out_final, status });
  }

  _evalStatus(P_out, results) {
    if (results.some(r => r.blocked)) return { code: 'blocked', label: 'BLOCKED' };
    if (P_out < 0)   return { code: 'error', label: 'NEGATİF BASINÇ' };
    if (P_out < 0.3) return { code: 'warn',  label: 'DÜŞÜK BASINÇ'  };
    return                  { code: 'ok',    label: 'NORMAL'         };
  }

  // ── Layout ───────────────────────────────────────────────
  get layout() { return computeLayout(this._components); }

  // ── Serialize ────────────────────────────────────────────
  serialize() {
    return {
      version: 2,
      systemConfig: SystemConfig.snapshot(),
      components: this._components.map(c => c.serialize()),
    };
  }

  deserialize(data, componentFactory) {
    this.clear();
    if (data.systemConfig) {
      Object.entries(data.systemConfig).forEach(([k, v]) => SystemConfig.set(k, v));
    }
    data.components?.forEach(d => {
      const comp = componentFactory(d.type, d.subtype);
      comp.applySerializedData(d);
      this.insert(comp);
    });
    return this;
  }

  get calcResults() { return this._calcResults; }
}

export const pipelineStore = new PipelineStore();
