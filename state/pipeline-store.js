'use strict';

import { EventEmitter }   from '../core/event-emitter.js';
import { SystemConfig }   from './system-config.js';
import { computeLayout }  from '../utils/layout.js';
import { resetIdCounter } from '../components/base.js';


// S5: computeLayout artık utils/layout.js'ten — svg-renderer.js'e bağımlılık KALDIRILDI

export class PipelineStore extends EventEmitter {
	constructor() {
		super();
		this._components = [];   // ComponentBase[]
		this._selectedId  = null;

		// SystemConfig değişince yeniden hesapla
		SystemConfig.on('change', () => this.emit('components:change'));
	}

	insert(comp, atIndex = this._components.length) {
		if (atIndex > 0) {
			const prev  = this._components[atIndex - 1];
			const prevD = prev.outDiameter_mm;

			const isTransition = comp.subtype === 'reducer' || comp.subtype === 'expander';

			if (isTransition) {
				// Giriş çapı her zaman öncekinden gelsin
				comp._overrides.d_in_mm = prevD;
			} else if (!comp.hasOverride('diameter_mm')) {
				comp.override('diameter_mm', prevD);
			}
		}

		this._components.splice(atIndex, 0, comp);
		this._propagateDiameter(atIndex);
		this.emit('components:change');
		return this;
	}

	_propagateDiameter(fromIdx = 1) {
		const comps = this._components;

		for (let i = Math.max(1, fromIdx); i < comps.length; i++) {
			const prev  = comps[i - 1];
			const curr  = comps[i];
			const prevD = prev.outDiameter_mm;

			const isTransition = curr.subtype === 'reducer' || curr.subtype === 'expander';

			if (isTransition) {
				curr._overrides.d_in_mm = prevD;
			} else if (!curr.hasUserOverride('diameter_mm')) {
				curr.override('diameter_mm', prevD);
			}
		}
	}

	// M8: Public wrapper — dışarıdan _propagateDiameter çağrısı yerine bunu kullan
	propagateDiameterFrom(comp) {
		this._propagateDiameter(this._components.indexOf(comp));
	}

	remove(compId) {
		const idx = this._components.findIndex(c => c.id === compId);
		if (idx === -1) return this;
		this._components.splice(idx, 1);
		if (this._selectedId === compId) this._selectedId = null;
		this.emit('components:change');
		return this;
	}

	clear() {
		this._components = [];
		this._selectedId  = null;
		this.emit('components:change');
		return this;
	}

	select(compId) {
		this._selectedId = compId;
		this.emit('selection:change', compId);
		return this;
	}

	deselect() { return this.select(null); }

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

		const comps = data.components ?? [];

		// S9: İlk eleman pompa olmalı — değilse yüklemeyi iptal et
		if (comps.length > 0 && comps[0].type !== 'pump') {
			console.error('[PipelineStore] deserialize: İlk eleman pompa değil, yükleme iptal edildi.');
			this.emit('components:change');
			return this;
		}

		// B4: insert() yerine direkt push — her eleman kendi id'sini serialize'dan alır
		// insert() çağrılsaydı _propagateDiameter her adımda tetiklenirdi (gereksiz)
		comps.forEach(d => {
			const comp = componentFactory(d.type, d.subtype);
			comp.applySerializedData(d);
			this._components.push(comp);
		});

		// Tüm elemanlar yerleştikten sonra tek seferde çap propagasyonu
		this._propagateDiameter(1);

		// B3: Yüklenen en yüksek id'yi bul, counter'ı hizala
		const maxId = this._components.reduce((m, c) => Math.max(m, c.id), 0);
		resetIdCounter(maxId);

		this.emit('components:change');
		return this;
	}

	get selectedId()   { return this._selectedId; }
	get selectedComp() { return this._components.find(c => c.id === this._selectedId) ?? null; }
	get layout()       { return computeLayout(this._components); }
	get components()   { return [...this._components]; }
	get length()       { return this._components.length; }

	getWarnings() {
		const warnings = [];
		const comps    = this._components;

		for (let i = 0; i < comps.length - 1; i++) {
			const curr = comps[i];
			const next = comps[i + 1];

			const currOut = curr.outDiameter_mm;
			const nextIn  = next.subtype === 'reducer' || next.subtype === 'expander'
				? next.d_in_mm
				: next.diameter_mm;

			if (Math.abs(currOut - nextIn) > 0.5) {
				const hasManual = next.hasUserOverride('diameter_mm') ||
					next._overrides.d_in_mm != null;

				warnings.push({
					atIndex:  i,           // i ile i+1 arasındaki bağlantı noktası
					fromComp: curr,
					toComp:   next,
					fromD:    currOut,
					toD:      nextIn,
					manual:   hasManual,
					message:  hasManual
						? `${curr.name || curr.type} (${currOut}mm) → ${next.name || next.type} (${nextIn}mm) — manual override`
						: `Diameter mismatch: ${currOut}mm → ${nextIn}mm`,
				});
			}
		}

		return warnings;
	}
}

export const pipelineStore = new PipelineStore();