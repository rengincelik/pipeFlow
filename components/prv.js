'use strict';

// ═══════════════════════════════════════════════════════════
// PRV — Pressure Reducing Valve
// Animasyonlu piston + T-şekli SVG sembolü.
//
// Sembol yapısı (yatay hat, entryDir='right'):
//
//        [piston]      ← basınca göre yukarı/aşağı kayar
//           │  yay
//      ─────┼─────     ← ana hat
//           │
//          ═══         ← relief port (prv-active'de renk değişir)
//
// Piston pozisyonu: P_in / P_set oranıyla hesaplanır.
// data-prv-piston="<id>" ile tick'te main.js tarafından güncellenir.
// ═══════════════════════════════════════════════════════════

import { ComponentBase, registerComponentType } from './base.js';
import { Units }                                from '../data/unit-system.js';

// -- Boyut sabitleri --
const BODY_W   = 54;   // ana hat uzunlugu (px)
const STEM_UP  = 18;   // ana hattan daire merkezine (yukari)
const STEM_DN  = 12;   // ana hattan port cizgilerine (asagi)
const R        = 6;    // durum dairesi yaricapi
const PORT_W   = 10;   // port cizgisi yari genisligi
const PORT_GAP = 4;    // port cizgileri arasi bosluk


export class PRVComponent extends ComponentBase {

  static get CONSTRAINTS() {
    return {
      P_set_bar: { min: 0.1, max: 100, step: 0.1, unit: 'bar' },
    };
  }

  constructor() {
    super('valve', 'prv');
    this.name   = 'PRV';
    this._lenPx = BODY_W;
  }

  get P_set_bar() {
    return this._overrides.P_set_bar ?? this.resolve('P_set_bar') ?? 1.0;
  }

  getParams() {
    return {
      type:        'valve',
      subtype:     'prv',
      diameter_mm: this.resolve('diameter_mm'),
      P_set_Pa:    this.P_set_bar * 1e5,
    };
  }

  // ── SVG ──────────────────────────────────────────────────

  shapeSpec(layout) {
    const { ix, iy } = layout;
    const mx = ix + BODY_W / 2;
    const my = iy;

    // Durum dairesi merkezi (ana hatin ustunde)
    const circY = my - STEM_UP;

    // Alt port cizgilerinin baslangic Y'si
    const portTopY = my + STEM_DN;

    return {
      itemShape: [

        // Ana hat (tam gecis)
        { tag: 'line', cls: 'prv-stem',
          x1: ix, y1: my, x2: ix + BODY_W, y2: my },

        // Dikey kol yukari: ana hat -> daire
        { tag: 'line', cls: 'prv-stem',
          x1: mx, y1: my, x2: mx, y2: circY + R },

        // Durum dairesi - data-prv-circle ile tick'te fill guncellenir
        { tag: 'circle', cls: 'prv-status-circle',
          cx: mx, cy: circY, r: R,
          'data-prv-circle': this.id },

        // Dikey kol asagi: ana hat -> port cizgileri
        { tag: 'line', cls: 'prv-stem',
          x1: mx, y1: my, x2: mx, y2: portTopY },

        // Port cizgisi 1
        { tag: 'line', cls: 'prv-port-line',
          x1: mx - PORT_W, y1: portTopY,
          x2: mx + PORT_W, y2: portTopY },

        // Port cizgisi 2
        { tag: 'line', cls: 'prv-port-line',
          x1: mx - PORT_W, y1: portTopY + PORT_GAP,
          x2: mx + PORT_W, y2: portTopY + PORT_GAP },

        // Port cizgisi 3
        { tag: 'line', cls: 'prv-port-line',
          x1: mx - PORT_W, y1: portTopY + PORT_GAP * 2,
          x2: mx + PORT_W, y2: portTopY + PORT_GAP * 2 },

      ],
      anchors:     [{ type: 'label', x: mx, y: my }],
      orientation: this.entryDir,
    };
  }


  getLabelContent(type) {
    if (type === 'label') return `PRV ${this.P_set_bar}bar`;
    return null;
  }

  // ── Props Panel ──────────────────────────────────────────

  renderPropsHTML() {
    const dVal    = this.diameter_mm;
    const psetVal = this.P_set_bar;

    return [
      this.row('Diameter',
        this.value(dVal) +
        this.hint(dVal, v => Units.diameter(v)), 'mm'),

      this.row('Set Pressure',
        this.input('P_set_bar', psetVal) +
        this.hint(psetVal, () => `${(psetVal * 14.504).toFixed(1)} psi`), 'bar'),

      this.row('Status',
        `<span class="prop-value" data-live="prv_status">—</span>`),

      this.row('Inlet P',
        `<span class="prop-value" data-live="prv_p_in">—</span>`),
    ].join('');
  }

  // ── Serialize ────────────────────────────────────────────

  serialize() {
    return { ...super.serialize(), P_set_bar: this.P_set_bar };
  }

  applySerializedData(d) {
    super.applySerializedData(d);
    if (d.P_set_bar != null) this.override('P_set_bar', d.P_set_bar, true);
    return this;
  }
}


registerComponentType('valve', 'prv', () => new PRVComponent());
