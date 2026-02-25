'use strict';

// ═══════════════════════════════════════════════════════════
// COMPONENT BASE — tüm boru hattı elemanlarının ana sınıfı
// ═══════════════════════════════════════════════════════════

import { EventEmitter }    from '../core/event-emitter.js';
import { OverrideMixin }   from '../state/system-config.js';
import { svgEl, setAttrs } from '../renderer/svg-utils.js';

let _idCounter = 0;

export const DIR_VEC = {
  right: { dx:  1, dy:  0 },
  left:  { dx: -1, dy:  0 },
  down:  { dx:  0, dy:  1 },
  up:    { dx:  0, dy: -1 },
};



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
  // ComponentBase.js içinde
/**
   * createSVG: Ana orkestra şefi.
   * Grubu oluşturur, hitbox ekler ve içeriği ister.
   */
  createSVG(layout, labelLayer) {
      const g = svgEl('g');
      g.classList.add('component', this.type, `id-${this.id}`);

      // 1. İçeriği Çiz (Geometri ve Dönüşüm)
      const spec = this.shapeSpec(layout);
      const content = this.drawContent(spec, layout);
      g.appendChild(content);

      // 2. Hitbox (Boyutu content'ten alacak)
      const hitbox = svgEl('rect');
      hitbox.classList.add('hitbox');
      hitbox.setAttribute('fill', 'transparent');
      hitbox.setAttribute('pointer-events', 'all');
      g.insertBefore(hitbox, content); // Hitbox en altta ama tıklanabilir

      // 3. Akıllı Etiketler (Dinamik İçerik ve Ofset)
      if (labelLayer && spec.anchors) {
        this.renderSmartLabels(labelLayer, spec.anchors, spec.orientation);
      }

      // 4. Hitbox Otomasyonu
      setTimeout(() => {
        const bbox = content.getBBox();
        const pad = 8;
        hitbox.setAttribute('x', bbox.x - pad);
        hitbox.setAttribute('y', bbox.y - pad);
        hitbox.setAttribute('width', bbox.width + pad * 2);
        hitbox.setAttribute('height', bbox.height + pad * 2);
      }, 0);

      return g;
    }

  drawContent(spec, layout) {
    const contentGroup = svgEl('g');
    contentGroup.classList.add('item-geometry');

    if (spec.itemShape) {
      spec.itemShape.forEach(p => {
        const el = svgEl(p.tag);

        // Sınıfları ekle
        if (p.cls) {
          p.cls.split(' ').filter(Boolean).forEach(c => el.classList.add(c));
        }

        // Attribute'ları güvenli bir şekilde bas
        Object.entries(p).forEach(([key, val]) => {
          // Obje olan değerleri (örn: layout) attribute olarak basma!
          if (!['tag', 'cls'].includes(key) && val != null && typeof val !== 'object') {
            el.setAttribute(key, val);
          }
        });

        contentGroup.appendChild(el);
      });
    }

    // Yönlendirme
    if (spec.orientation && spec.orientation !== 'static') {
      const angleMap = { 'down': 90, 'up': -90, 'left': 180, 'right': 0 };
      const angle = angleMap[spec.orientation] || 0;

      if (angle !== 0) {
        // ix ve iy'nin sayı olduğundan emin olalım (parseFloat veya Number)
        const cx = Number(layout.ix);
        const cy = Number(layout.iy);
        contentGroup.setAttribute('transform', `rotate(${angle}, ${cx}, ${cy})`);
      }
    }

    return contentGroup;
  }


  renderSmartLabels(labelLayer, anchors, orientation) {
      const isVertical = orientation === 'up' || orientation === 'down';

      anchors.forEach(anchor => {
        const text = this.getLabelContent(anchor.type);
        if (!text) return;

        const el = svgEl('text');
        el.classList.add('lbl', `lbl-${anchor.type}`);

        // Ofset Tablosu (Burayı istediğin gibi global yönetebilirsin)
        let dx = 0, dy = 0;
        const offsets = {
          'dim': isVertical ? { dx: 18, dy: -8 } : { dx: 0, dy: -22 },
          'len': isVertical ? { dx: 18, dy: 2 }  : { dx: 0, dy: -12 },
          'vel': isVertical ? { dx: 18, dy: 12 } : { dx: 0, dy: -2 }
        };

        const off = offsets[anchor.type] || { dx: 0, dy: 0 };
        el.setAttribute('x', anchor.x + off.dx);
        el.setAttribute('y', anchor.y + off.dy);
        el.setAttribute('text-anchor', isVertical ? 'start' : 'middle');
        el.textContent = text;

        labelLayer.appendChild(el);
      });
  }

  getLabelContent(type) {
    // Dinamik veri eşleştirme
    const data = {
      'dim': `⌀${this.diameter_mm}mm`,
      'len': `${this._overrides.length_m ?? 5}m`,
      'vel': this.result?.v != null ? `v=${this.result.v.toFixed(2)}m/s` : null
    };
    return data[type];
  }
  // ComponentBase.js içinde
  updateSVG(g, layout, labelLayer) {
    // 1. Koordinatlar değişmiş olabilir, içeriği yeniden üretelim
    // (veya sadece transform ile grubu taşıyalım)
    const spec = this.shapeSpec(layout);

    // İçeriği temizleyip yeniden çizmek en garantisidir (özellikle boyutu değişen Pipe için)
    const geometryLayer = g.querySelector('.item-geometry');
    if (geometryLayer) {
      geometryLayer.remove();
    }

    const newContent = this.drawContent(spec, layout);
    g.appendChild(newContent);

    // 2. Etiketleri güncelle (Dinamik veri ve yeni konum için)
    if (labelLayer && spec.anchors) {
      this.renderSmartLabels(labelLayer, spec.anchors, spec.orientation);
    }

    // 3. Hitbox'ı yeni boyuta göre tazele
    const hitbox = g.querySelector('.hitbox');
    setTimeout(() => {
      if (!newContent.getBBox || !hitbox) return;
      const bbox = newContent.getBBox();
      const pad = 8;
      hitbox.setAttribute('x', bbox.x - pad);
      hitbox.setAttribute('y', bbox.y - pad);
      hitbox.setAttribute('width', bbox.width + pad * 2);
      hitbox.setAttribute('height', bbox.height + pad * 2);
    }, 0);
  }





  // ComponentBase.js içinde
  calcHydraulics(Q_m3s, fluid) {
    const D = this.diameter_mm / 1000;
    const area = (Math.PI * D * D) / 4;
    const v = Q_m3s / area;
    const nu = (fluid.mu_mPas / 1000) / fluid.rho;
    const Re = reynolds(v, D, nu);

    // Varsayılan sonuç objesi (Her bileşen bunu genişletecek)
    this.result = {
      v,
      Re,
      dP_Pa: 0,
      hf: { total: 0, fittings: 0, friction: 0, elevation: 0 }
    };

    return this.result;
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
 

  row(label, content, unit = '') {
    return `<div class="pr"><span class="pl">${label}</span>${content}${unit ? `<span class="pu">${unit}</span>` : ''}</div>`;
  }

  select(prop, options, currentVal) {
    const opts = options.map(o =>
      `<option value="${o.value}" ${String(o.value) === String(currentVal) ? 'selected' : ''}>${o.label}</option>`
    ).join('');
    return `<select class="p-select" data-prop="${prop}">${opts}</select>`;
  }

  input(prop, value, step = "1") {
    return `<input class="p-input" type="number" value="${value}" step="${step}" data-prop="${prop}">`;
  }
    // Sadece değer gösteren (readonly) alanlar için yeni bir metod
  value(val, unit = '') {
    return `<span class="pv">${val}</span>`;
  }

  // "Dim" (soluk) görünen değerler için
  dimValue(val) {
    return `<span class="pv dim">${val}</span>`;
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


