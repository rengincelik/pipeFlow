'use strict';

// ═══════════════════════════════════════════════════════════
// COMPONENT BASE — tüm boru hattı elemanlarının ana sınıfı
// ═══════════════════════════════════════════════════════════

import { EventEmitter }    from '../core/event-emitter.js';
import { OverrideMixin }   from '../state/system-config.js';
import { svgEl, setAttrs } from '../renderer/svg-utils.js';

let _idCounter = 0;

// ── Yön vektörleri ────────────────────────────────────────
export const DIR_VEC = {
  right: { dx:  1, dy:  0 },
  left:  { dx: -1, dy:  0 },
  down:  { dx:  0, dy:  1 },
  up:    { dx:  0, dy: -1 },
};

// ── Flow-line animasyonu ──────────────────────────────────
function _speedToDuration(v) {
  return Math.min(4, Math.max(0.3, 1.2 / v)).toFixed(2) + 's';
}

function _updateFlowLine(g, layout, regimeCode, v) {
  const { ix, iy, ox, oy } = layout;
  let fl = g.querySelector('.flow-line');
  if (!fl) {
    fl = svgEl('line');
    fl.classList.add('flow-line');
    const arrow = g.querySelector('.pipe-arrow');
    arrow ? g.insertBefore(fl, arrow) : g.appendChild(fl);
  }
  setAttrs(fl, { x1: ix, y1: iy, x2: ox, y2: oy });
  const colMap = { L: 'var(--c-lam)', Tr: 'var(--c-tr)', T: 'var(--c-turb)' };
  fl.style.setProperty('--flow-color', colMap[regimeCode] ?? 'var(--c-turb)');
  fl.style.setProperty('--flow-dur',   _speedToDuration(v));
}

// ═══════════════════════════════════════════════════════════
export class ComponentBase extends EventEmitter {
  constructor(type, subtype) {
    super();
    this.id       = ++_idCounter;
    this.type     = type;
    this.subtype  = subtype;
    this.name     = '';
    this.entryDir = 'right';
    this.exitDir  = 'right';

    Object.assign(this, OverrideMixin);
    this._overrides = {};
    this.result     = null;
  }

  // ── Çözümleme kısayolları ──────────────────────────────
  get diameter_mm() { return this.resolve('diameter_mm'); }
  get eps_mm()      { return this.resolve('eps_mm'); }
  get fluid_id()    { return this.resolve('fluid_id'); }

  _onOverrideChange(key) { this.emit('override:change', key); }

  // ── Çıkış noktası hesabı ───────────────────────────────
  /**
   * Giriş noktası + yön + uzunluktan çıkış noktasını hesaplar.
   * Elbow override eder (köşe geometrisi farklı).
   * @param {number} ix  giriş X
   * @param {number} iy  giriş Y
   * @returns {{ ox, oy, exitDir }}
   */
  computeExit(ix, iy) {
    const vec = DIR_VEC[this.entryDir];
    const len = this._lenPx ?? 54;   // alt sınıf set eder
    return {
      ox:      ix + vec.dx * len,
      oy:      iy + vec.dy * len,
      exitDir: this.exitDir,
    };
  }

  // ── SVG arayüzü ────────────────────────────────────────
  /**
   * layout = { ix, iy, ox, oy, entryDir, exitDir, lenPx }
   * ix/iy = giriş noktası (world coords)
   * ox/oy = çıkış noktası (world coords)
   * Tüm elemanlar yatay (right) baz alınarak çizilir.
   * Renderer entryDir'e göre SVG transform uygular.
   */
  createSVG(layout) {
    throw new Error(`${this.constructor.name}.createSVG() implement edilmemiş`);
  }

  updateSVG(g, layout) {
    g.classList.toggle('sel', Boolean(this._selected));

    const regime = this.result?.regime;
    const v      = this.result?.v;

    if (regime) {
      g.dataset.regime = regime.code;
    } else {
      delete g.dataset.regime;
    }

    const isPipeType = this.type === 'pipe';
    if (isPipeType && v != null && isFinite(v) && v > 0) {
      _updateFlowLine(g, layout, regime?.code ?? 'T', v);
    } else {
      g.querySelector('.flow-line')?.remove();
    }
  }

  renderPropsHTML() { return ''; }

  serialize() {
    return {
      type:      this.type,
      subtype:   this.subtype,
      name:      this.name,
      entryDir:  this.entryDir,
      exitDir:   this.exitDir,
      overrides: this.serializeOverrides(),
    };
  }

  applySerializedData(data) {
    if (data.overrides) {
      Object.entries(data.overrides).forEach(([k, v]) => this.override(k, v));
    }
    if (data.name)     this.name     = data.name;
    if (data.entryDir) this.entryDir = data.entryDir;
    if (data.exitDir)  this.exitDir  = data.exitDir;
    return this;
  }

  get outDiameter_mm() { return this.diameter_mm; }

  get statusSummary() {
    if (!this.result) return '—';
    const r = this.result;
    if (r.blocked) return 'BLOCKED';
    return `v=${r.v?.toFixed(2)}m/s  Re=${r.Re?.toLocaleString()}`;
  }
}

// ── FACTORY MAP ───────────────────────────────────────────
const _registry = new Map();

export function registerComponentType(type, subtype, ctor) {
  _registry.set(`${type}:${subtype}`, ctor);
}

export function createComponent(type, subtype) {
  const key  = `${type}:${subtype}`;
  const Ctor = _registry.get(key) ?? _registry.get(`${type}:*`);
  if (!Ctor) throw new Error(`Bilinmeyen komponent: ${key}`);
  return Ctor();
}

export function deserializeComponent(data) {
  const comp = createComponent(data.type, data.subtype);
  comp.applySerializedData(data);
  return comp;
}
