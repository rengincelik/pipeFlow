'use strict';

// COMPONENT PARAM VALIDATION
// Engine'e giren her params objesini temizler.
// NaN, null, undefined, negatif/sıfır fiziksel değer → güvenli fallback.
// Hata fırlatmaz — her zaman geçerli bir params döner.
// Validation hatası varsa params.__warnings dizisine yazar.

// ── Tip bazlı FALLBACK değerleri ──────────────────────────────────────────
// Bunlar engine'in NaN üretmeden çalışabileceği minimum güvenli değerler.
const FALLBACKS = {
  diameter_mm:  50.0,   // DN50 — makul varsayılan
  length_m:     1.0,
  eps_mm:       0.046,  // çelik boru, Moody
  height_m:     0,
  K:            1.0,
  opening:      1.0,
  efficiency:   0.75,
  d_in_mm:      50.0,
  d_out_mm:     25.0,
  P_set_Pa:     100_000, // 1 bar
};

// ── Pozitif olmak zorunda olan alanlar (0 ve negatif geçersiz) ─────────────
const MUST_BE_POSITIVE = new Set([
  'diameter_mm', 'd_in_mm', 'd_out_mm', 'length_m', 'eps_mm',
]);

// ── 0–1 aralığında olması gereken alanlar ─────────────────────────────────
const CLAMP_0_1 = new Set(['opening', 'efficiency']);

// ── Alan bazlı sınırlar ───────────────────────────────────────────────────
const FIELD_LIMITS = {
  diameter_mm: { min: 1,    max: 3000  },
  d_in_mm:     { min: 1,    max: 3000  },
  d_out_mm:    { min: 1,    max: 3000  },
  length_m:    { min: 0.01, max: 10_000 },
  eps_mm:      { min: 0,    max: 10    },
  K:           { min: 0,    max: 1e6   },
  P_set_Pa:    { min: 0,    max: 1e8   },
  height_m:    { min: -500, max: 500   },
};

// ── hq_coeffs için ayrı kontrol ──────────────────────────────────────────
function validateHQCoeffs(coeffs, warnings, compType) {
  if (!coeffs || typeof coeffs !== 'object') {
    warnings.push(`${compType}: hq_coeffs eksik — sabit head fallback kullanılıyor`);
    return { a0: 30, a1: 0, a2: -1e4 }; // ~30m shutoff, Q_max~0.055 m³/s
  }

  const safe = { ...coeffs };
  let fixed = false;

  if (!isFinite(safe.a0) || safe.a0 <= 0) {
    safe.a0 = 30;
    fixed = true;
  }
  if (!isFinite(safe.a1)) {
    safe.a1 = 0;
    fixed = true;
  }
  // a2 negatif olmalı (H-Q eğrisi aşağı eğimli)
  if (!isFinite(safe.a2) || safe.a2 >= 0) {
    safe.a2 = -safe.a0 / (0.05 * 0.05); // Q_max ≈ 0.05 m³/s varsayımı
    fixed = true;
  }

  if (fixed) {
    warnings.push(`${compType}: hq_coeffs düzeltildi (a0=${safe.a0.toFixed(1)}, a2=${safe.a2.toFixed(0)})`);
  }

  return safe;
}

// ── Tek alan doğrulama ────────────────────────────────────────────────────
function sanitizeField(key, val, fallback, warnings, compType) {
  // null / undefined
  if (val == null) {
    warnings.push(`${compType}.${key}: tanımsız → ${fallback} kullanıldı`);
    return fallback;
  }

  // NaN / Infinity
  if (!isFinite(val)) {
    warnings.push(`${compType}.${key}: ${val} geçersiz → ${fallback} kullanıldı`);
    return fallback;
  }

  // Pozitif zorunlu
  if (MUST_BE_POSITIVE.has(key) && val <= 0) {
    warnings.push(`${compType}.${key}: ${val} ≤ 0 → ${fallback} kullanıldı`);
    return fallback;
  }

  // 0–1 clamp
  if (CLAMP_0_1.has(key)) {
    const clamped = Math.max(0, Math.min(1, val));
    if (clamped !== val) {
      warnings.push(`${compType}.${key}: ${val} → [0,1]'e sıkıştırıldı: ${clamped}`);
      return clamped;
    }
  }

  // Alan sınırları
  const limits = FIELD_LIMITS[key];
  if (limits) {
    if (val < limits.min) {
      warnings.push(`${compType}.${key}: ${val} < min(${limits.min}) → ${limits.min} kullanıldı`);
      return limits.min;
    }
    if (val > limits.max) {
      warnings.push(`${compType}.${key}: ${val} > max(${limits.max}) → ${limits.max} kullanıldı`);
      return limits.max;
    }
  }

  return val;
}

// ── ANA DOĞRULAMA FONKSİYONU ─────────────────────────────────────────────

/**
 * Component getParams() çıkışını engine'e girmeden önce temizler.
 *
 * @param {object} params — component.getParams() çıktısı
 * @returns {object}      — temiz params + __warnings dizisi
 *
 * Kural:
 *  - Asla throw etme
 *  - params.__warnings[] — ne düzeltildi
 *  - params.__invalid    — true ise kritik alan düzeltildi (engine loglamalı)
 */
export function validateParams(params) {
  if (!params || typeof params !== 'object') {
    return {
      type: 'unknown', subtype: 'unknown',
      __warnings: ['params tamamen geçersiz — boş obje döndürüldü'],
      __invalid: true,
    };
  }

  const warnings = [];
  const compLabel = `${params.type ?? '?'}/${params.subtype ?? '?'}`;
  const safe = { ...params, __warnings: warnings, __invalid: false };

  // ── Tip bazlı doğrulama ───────────────────────────────────────────────

  switch (params.type) {

    case 'pump': {
      safe.hq_coeffs  = validateHQCoeffs(params.hq_coeffs, warnings, compLabel);
      safe.diameter_mm = sanitizeField('diameter_mm', params.diameter_mm,
        FALLBACKS.diameter_mm, warnings, compLabel);
      safe.efficiency  = sanitizeField('efficiency',  params.efficiency,
        FALLBACKS.efficiency,  warnings, compLabel);
      break;
    }

    case 'pipe': {
      safe.diameter_mm = sanitizeField('diameter_mm', params.diameter_mm,
        FALLBACKS.diameter_mm, warnings, compLabel);
      safe.length_m    = sanitizeField('length_m',    params.length_m,
        FALLBACKS.length_m,    warnings, compLabel);
      safe.eps_mm      = sanitizeField('eps_mm',      params.eps_mm,
        FALLBACKS.eps_mm,      warnings, compLabel);
      // height_m opsiyonel — 0 kabul edilir
      safe.height_m    = isFinite(params.height_m) ? params.height_m : 0;
      break;
    }

    case 'elbow': {
      safe.diameter_mm = sanitizeField('diameter_mm', params.diameter_mm,
        FALLBACKS.diameter_mm, warnings, compLabel);
      safe.K           = sanitizeField('K',           params.K,
        FALLBACKS.K,           warnings, compLabel);
      // K=0 geçerli (ideal dirsek) — negatif değil
      if (safe.K < 0) { safe.K = FALLBACKS.K; warnings.push(`${compLabel}.K negatif → fallback`); }
      break;
    }

    case 'transition': {
      safe.d_in_mm  = sanitizeField('d_in_mm',  params.d_in_mm,
        FALLBACKS.d_in_mm,  warnings, compLabel);
      safe.d_out_mm = sanitizeField('d_out_mm', params.d_out_mm,
        FALLBACKS.d_out_mm, warnings, compLabel);

      // d_in === d_out fiziksel anlamsız (ama engine çarpmaz, sadece uyar)
      if (Math.abs(safe.d_in_mm - safe.d_out_mm) < 0.1) {
        warnings.push(`${compLabel}: d_in ≈ d_out (${safe.d_in_mm}mm) — eleman etkisiz`);
      }
      break;
    }

    case 'valve': {
      safe.diameter_mm = sanitizeField('diameter_mm', params.diameter_mm,
        FALLBACKS.diameter_mm, warnings, compLabel);

      // PRV'nin opening kavramı yok — sadece normal vanalar için kontrol et
      if (params.subtype !== 'prv') {
        safe.opening = sanitizeField('opening', params.opening,
          FALLBACKS.opening, warnings, compLabel);
      }

      if (params.subtype === 'prv') {
        safe.P_set_Pa = sanitizeField('P_set_Pa', params.P_set_Pa,
          FALLBACKS.P_set_Pa, warnings, compLabel);
      }
      break;
    }

    default: {
      // Bilinmeyen tip — mevcut alanları geçir, uyar
      warnings.push(`${compLabel}: bilinmeyen tip — alanlar doğrulanmadı`);
      break;
    }
  }

  if (warnings.length > 0) {
    safe.__invalid = true;
  }

  return safe;
}

// ── TOPLU DOĞRULAMA (engine öncesi tüm zincir) ───────────────────────────

/**
 * Pipeline component listesini tarayıp hataları önceden raporlar.
 * Engine başlatılmadan çağrılabilir.
 *
 * @param {ComponentBase[]} components
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePipeline(components) {
  const errors = [];

  if (!components || components.length === 0) {
    return { valid: false, errors: ['Pipeline boş'] };
  }

  if (components[0].type !== 'pump') {
    errors.push('İlk eleman pompa değil');
  }

  components.forEach((comp, idx) => {
    let params;
    try {
      params = comp.getParams();
    } catch (e) {
      errors.push(`[${idx}] ${comp.type}: getParams() fırlattı — ${e.message}`);
      return;
    }

    const safe = validateParams(params);
    safe.__warnings.forEach(w => errors.push(`[${idx}] ${w}`));
  });

  return {
    valid:  errors.length === 0,
    errors,
  };
}
