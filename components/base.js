'use strict';

// COMPONENT BASE — tüm boru hattı elemanlarının ana sınıfı

import { EventEmitter }    from '../core/event-emitter.js';
import { OverrideMixin }   from '../core/override-mixin';
import { svgEl, setAttrs } from '../renderer/svg-utils.js';
import { Units }           from '../data/unit-system.js';
import { validateParams } from './validation.js';

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
		this.id          = ++_idCounter;
		this.type        = type;
		this.subtype     = subtype;
		this.name        = '';
		this.entryDir    = 'right';
		this.exitDir     = 'right';

		Object.assign(this, OverrideMixin);
		this._overrides  = {};
		this._userOverrides = new Set();
		this.result      = null;
	}

	// ── Static CONSTRAINTS — alt sınıf override eder ──────────
	/**
	 * Format:
	 * {
	 *   prop_name: { min, max, step, unit? }
	 * }
	 * "unit" opsiyonel — renderPropsHTML'de görüntülenecekse
	 */
	static get CONSTRAINTS() { return {}; }

	/**
	 * Belirli bir prop için constraint döner.
	 * Instance üzerinden çağrılabilmesi için instance method olarak da var.
	 */
	getConstraint(key) {
		return this.constructor.CONSTRAINTS[key] ?? null;
	}

	// ── Çözümleme kısayolları ──────────────────────────────
	get diameter_mm() { return this.resolve('diameter_mm'); }
	get eps_mm()      { return this.resolve('eps_mm'); }
	get fluid_id()    { return this.resolve('fluid_id'); }

	_onOverrideChange(key) { this.emit('override:change', key); }

	getParams() {
		return { type: this.type, subtype: this.subtype };
	}

	getSafeParams() {
		const raw  = this.getParams();
		const safe = validateParams(raw);

		if (safe.__invalid && safe.__warnings.length > 0) {
			const key = safe.__warnings.join('|');
			if (key !== this._lastWarningKey) {
				this._lastWarningKey = key;
				console.warn(
					`[Validation] ${this.type}/${this.subtype} (id:${this.id}):`,
					safe.__warnings
				);
			}
		} else {
			this._lastWarningKey = null; // warning geçince sıfırla
		}
		return safe;
	}



	computeExit(ix, iy) {
		const vec = DIR_VEC[this.entryDir];
		const len = this._lenPx ?? 54;
		return {
			ox:      ix + vec.dx * len,
			oy:      iy + vec.dy * len,
			exitDir: this.exitDir,
		};
	}

	createSVG(layout, labelLayer) {
		const g = svgEl('g');
		g.classList.add('component', this.type, `id-${this.id}`);

		const spec    = this.shapeSpec(layout);
		const content = this.drawContent(spec, layout);
		g.appendChild(content);

		const hitbox = svgEl('rect');
		hitbox.classList.add('hitbox');
		hitbox.setAttribute('fill', 'transparent');
		hitbox.setAttribute('pointer-events', 'all');
		g.insertBefore(hitbox, content);

		if (labelLayer && spec.anchors) {
			this.renderSmartLabels(labelLayer, spec.anchors, spec.orientation);
		}

		// B7: hitbox güncellemeyi private metoda al
		this._updateHitbox(content, hitbox);

		return g;
	}

	drawContent(spec, layout) {
		const contentGroup = svgEl('g');
		contentGroup.classList.add('item-geometry');

		if (spec.itemShape) {
			spec.itemShape.forEach(p => {
				const el = svgEl(p.tag);
				if (p.cls) {
					p.cls.split(' ').filter(Boolean).forEach(c => el.classList.add(c));
				}
				Object.entries(p).forEach(([key, val]) => {
					if (!['tag', 'cls'].includes(key) && val != null && typeof val !== 'object') {
						el.setAttribute(key, val);
					}
				});
				contentGroup.appendChild(el);
			});
		}

		if (spec.orientation && spec.orientation !== 'static') {
			const angleMap = { down: 90, up: -90, left: 180, right: 0 };
			const angle    = angleMap[spec.orientation] || 0;
			if (angle !== 0) {
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

			const offsets = {
				dim: isVertical ? { dx: 18, dy: -8  } : { dx: 0, dy: -22 },
				len: isVertical ? { dx: 18, dy:  2  } : { dx: 0, dy: -12 },
				vel: isVertical ? { dx: 18, dy: 12  } : { dx: 0, dy:  -2 },
			};
			const off = offsets[anchor.type] || { dx: 0, dy: 0 };
			el.setAttribute('x', anchor.x + off.dx);
			el.setAttribute('y', anchor.y + off.dy);
			el.setAttribute('text-anchor', isVertical ? 'start' : 'middle');
			el.textContent = text;
			labelLayer.appendChild(el);
		});
	}

	getLabelContent(type) {}

	updateSVG(g, layout, labelLayer) {
		const spec          = this.shapeSpec(layout);
		const geometryLayer = g.querySelector('.item-geometry');
		if (geometryLayer) geometryLayer.remove();

		const newContent = this.drawContent(spec, layout);
		g.appendChild(newContent);

		if (labelLayer && spec.anchors) {
			this.renderSmartLabels(labelLayer, spec.anchors, spec.orientation);
		}

		const hitbox = g.querySelector('.hitbox');
		// B7: hitbox güncellemeyi private metoda al
		this._updateHitbox(newContent, hitbox);
	}

	// B7: İki yerde tekrarlanan setTimeout → tek private metot
	_updateHitbox(content, hitbox) {
		setTimeout(() => {
			if (!content.getBBox || !hitbox) return;
			const bbox = content.getBBox();
			const pad  = 8;
			hitbox.setAttribute('x',      bbox.x - pad);
			hitbox.setAttribute('y',      bbox.y - pad);
			hitbox.setAttribute('width',  bbox.width  + pad * 2);
			hitbox.setAttribute('height', bbox.height + pad * 2);
		}, 0);
	}

	calcHydraulics(Q_m3s, fluid) {

	}

	renderPropsHTML() { return ''; }

	serialize() {
		return {
			id: this.id,
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
		if(data.id) this.id = data.id;
		if (data.name)     this.name     = data.name;
		if (data.entryDir) this.entryDir = data.entryDir;
		if (data.exitDir)  this.exitDir  = data.exitDir;
		return this;
	}

	get outDiameter_mm() { return this.diameter_mm; }

	// ── renderPropsHTML yardımcıları ──────────────────────────

	hint(val, unitFn) {
		if (Units.isMetric) return '';
		return `<span class="prop-hint">${unitFn(val)}</span>`;
	}

	row(label, content, unit = '') {
		return `<div class="prop-row">
      <span class="prop-label">${label}</span>${content}${unit
			? `<span class="prop-unit">${unit}</span>`
			: ''}
    </div>`;
	}

	select(prop, options, currentVal) {
		const opts = options.map(o =>
			`<option value="${o.value}" ${String(o.value) === String(currentVal) ? 'selected' : ''}>${o.label}</option>`
		).join('');
		return `<select class="prop-selection" data-prop="${prop}">${opts}</select>`;
	}

	/**
	 * Sayısal input — CONSTRAINTS'ten otomatik min/max/step alır.
	 * Explicit argümanlar CONSTRAINTS'i override eder.
	 */
	input(prop, value, step, min, max) {
		const c    = this.getConstraint(prop) ?? {};
		const _step = step ?? c.step ?? 1;
		const _min  = min  ?? c.min;
		const _max  = max  ?? c.max;

		const minAttr = _min != null ? `min="${_min}"` : '';
		const maxAttr = _max != null ? `max="${_max}"` : '';

		return `<input class="prop-input" type="number"
      value="${value}" step="${_step}" ${minAttr} ${maxAttr}
      data-prop="${prop}">`;
	}

	/**
	 * Range slider — CONSTRAINTS'ten otomatik min/max/step alır.
	 */
	slider(prop, value, step, min, max) {
		const c    = this.getConstraint(prop) ?? {};
		const _min  = min  ?? c.min  ?? 0;
		const _max  = max  ?? c.max  ?? 100;
		const _step = step ?? c.step ?? 1;

		return `
      <div class="prop-slider-group">
        <input type="range" data-prop="${prop}"
          min="${_min}" max="${_max}" step="${_step}"
          value="${value}" class="prop-range">
        <span class="prop-slider-value">${value}${c.unit ?? ''}</span>
      </div>`;
	}

	// B8: unit parametresi artık body'de de kullanılıyor
	value(val, unit = '') {
		return `<span class="prop-value">${val}${unit ? ' ' + unit : ''}</span>`;
	}

	dimValue(val) {
		return `<span class="prop-value dim">${val}</span>`;
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

// B3: deserialize sonrası counter'ı en yüksek id'ye hizala
// pipeline-store.deserialize() sonunda çağrılır
export function resetIdCounter(maxId) {
	if (maxId > _idCounter) _idCounter = maxId;
}