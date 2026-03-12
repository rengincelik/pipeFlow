'use strict';

// ═══════════════════════════════════════════════════════════
// UNIT SYSTEM
// Tüm iç hesaplar SI'da kalır.
// Bu modül sadece görüntüleme katmanında dönüşüm yapar.
// engine, store, hesaplar hiç değişmez.
// ═══════════════════════════════════════════════════════════

// Dönüşüm katsayıları
const CONV = {
	bar_to_psi:   14.5038,
	ms_to_fts:    3.28084,
	lpm_to_gpm:   0.264172,
	mm_to_inch:   0.0393701,
	m_to_ft:      3.28084,
};

class UnitSystemClass {
	constructor() {
		this._current  = 'metric';  // 'metric' | 'imperial'
		this._listeners = [];
	}

	get current()    { return this._current; }
	get isMetric()   { return this._current === 'metric'; }
	get isImperial() { return this._current === 'imperial'; }

	toggle() {
		this._current = this.isMetric ? 'imperial' : 'metric';
		this._listeners.forEach(fn => fn(this._current));
	}

	onChange(fn) {
		this._listeners.push(fn);
		return this;
	}

	// ── Format fonksiyonları ──────────────────────────────────
	// Her fonksiyon hem sayı+birim string'i döner.

	/** bar → bar veya psi */
	pressure(bar, decimals) {
		if (this.isMetric) {
			const d = decimals ?? 3;
			return `${bar.toFixed(d)} bar`;
		}
		const d = decimals ?? 2;
		return `${(bar * CONV.bar_to_psi).toFixed(d)} psi`;
	}

	/** m/s → m/s veya ft/s */
	velocity(ms, decimals) {
		if (this.isMetric) {
			const d = decimals ?? 2;
			return `${ms.toFixed(d)} m/s`;
		}
		const d = decimals ?? 2;
		return `${(ms * CONV.ms_to_fts).toFixed(d)} ft/s`;
	}

	/** L/min → L/min veya GPM */
	flow(lpm, decimals) {
		if (this.isMetric) {
			const d = decimals ?? 1;
			return `${lpm.toFixed(d)} L/min`;
		}
		const d = decimals ?? 2;
		return `${(lpm * CONV.lpm_to_gpm).toFixed(d)} GPM`;
	}

	/** m m → mm veya inch */
	diameter(mm, decimals) {
		if (this.isMetric) {
			const d = decimals ?? 1;
			return `${mm.toFixed(d)} mm`;
		}
		const d = decimals ?? 3;
		return `${(mm * CONV.mm_to_inch).toFixed(d)}"`;
	}

	/** m → m veya ft */
	length(m, decimals) {
		if (this.isMetric) {
			const d = decimals ?? 2;
			return `${m.toFixed(d)} m`;
		}
		const d = decimals ?? 2;
		return `${(m * CONV.m_to_ft).toFixed(d)} ft`;
	}

	/** °C → °C veya °F */
	temp(c, decimals) {
		if (this.isMetric) {
			const d = decimals ?? 0;
			return `${Number(c).toFixed(d)}°C`;
		}
		const d = decimals ?? 1;
		return `${(c * 9 / 5 + 32).toFixed(d)}°F`;
	}

	// ── Eksen label'ları (grafik için) ───────────────────────

	pressureLabel() { return this.isMetric ? 'Pressure (bar)' : 'Pressure (psi)'; }
	velocityLabel() { return this.isMetric ? 'Velocity (m/s)' : 'Velocity (ft/s)'; }
	flowLabel()     { return this.isMetric ? 'Flow (L/min)'   : 'Flow (GPM)'; }

	// ── Ham sayı dönüşümleri (label olmadan, grafik için) ────
	//
	// pressureVal: Pa alır — engine her zaman Pa döner, bu fonksiyon tek çevirme noktası
	// Önceki imza: pressureVal(bar) — DEĞİŞTİ, tüm çağrı noktaları Pa gönderecek
	//
	/** Pa → bar (metric) veya psi (imperial) */
	pressureVal(Pa)  {
		const bar = Pa / 1e5;
		return this.isMetric ? bar : bar * CONV.bar_to_psi;
	}

	/** m/s → m/s (metric) veya ft/s (imperial) */
	velocityVal(ms)   { return this.isMetric ? ms  : ms  * CONV.ms_to_fts;  }

	/** L/min → L/min (metric) veya GPM (imperial) */
	flowVal(lpm)      { return this.isMetric ? lpm : lpm * CONV.lpm_to_gpm; }

	/** mm → mm (metric) veya inch (imperial) */
	diameterVal(mm)   { return this.isMetric ? mm  : mm  * CONV.mm_to_inch; }

	/** m → m (metric) veya ft (imperial) */
	lengthVal(m)      { return this.isMetric ? m   : m   * CONV.m_to_ft;    }

	/** °C → °C (metric) veya °F (imperial) */
	tempVal(c)        { return this.isMetric ? c   : c   * 9 / 5 + 32;       }

	// ── Hacim dönüşümü (HUD için) ────────────────────────────
	/**
	 * m³ → metrik'te L veya m³ (büyüklüğe göre),
	 *       imperial'de gal veya ft³
	 * Formatted string döner.
	 */
	volume(m3) {
		if (this.isMetric) {
			const L = m3 * 1000;
			return L < 1000
				? `${L.toFixed(1)} L`
				: `${(L / 1000).toFixed(2)} m³`;
		} else {
			// 1 m³ = 264.172 US gallon
			const gal = m3 * 264.172;
			return gal < 1000
				? `${gal.toFixed(1)} gal`
				: `${(gal / 1000).toFixed(2)} kgal`;
		}
	}
}

export const Units = new UnitSystemClass();