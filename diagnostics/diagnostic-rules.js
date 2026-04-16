// diagnostic-rules.js
// All diagnostic rules for PipeFlow.
// Each rule object produces 0 or 1 DiagnosticResult per evaluation call.
// Rules are pure functions — no side effects, no state.

import { DN_LIST } from '../data/catalogs.js';

// ---------------------------------------------------------------------------
// Helper — build a DiagnosticResult object
// ---------------------------------------------------------------------------
function result(id, category, severity, componentId, componentName, message, detail, advice, value, unit, threshold) {
  return { id, category, severity, componentId, componentName, message, detail, advice, value, unit, threshold, timestamp: Date.now() };
}

// ---------------------------------------------------------------------------
// Helper — detect viscous fluid from snapshot or SystemConfig
// mu_mPas > 5 → viscous thresholds apply
// ---------------------------------------------------------------------------
function isViscous(snapshot) {
  // snapshot.fluid carries mu in Pa·s (SI). Convert to mPas.
  if (snapshot?.fluid?.mu != null) return snapshot.fluid.mu * 1000 > 5;
  return false;
}

// ===========================================================================
// CATEGORY A — Component Physics  (requiresSnapshot: true)
// ===========================================================================

const HIGH_VELOCITY = {
  id: 'HIGH_VELOCITY',
  category: 'physics',
  requiresSnapshot: true,
  evaluate(comp, snapshot, _allComps, node) {
    if (!node || comp.type !== 'pipe') return null;
    const v = node.velocity_ms;
    if (!isFinite(v)) return null;

    const viscous = isViscous(snapshot);
    const warnThresh  = viscous ? 1.5 : 2.5;
    const critThresh  = viscous ? 2.5 : 3.5;

    if (v <= warnThresh) return null;

    const severity = v > critThresh ? 'critical' : 'warning';
    const diff = (v - warnThresh).toFixed(2);
    return result(
      'HIGH_VELOCITY', 'physics', severity,
      comp.id, comp.name,
      'Velocity exceeds recommended range',
      `Current velocity ${v.toFixed(2)} m/s — threshold ${warnThresh} m/s. Excess: ${diff} m/s. Erosion and noise risk at fittings.`,
      'Consider increasing pipe diameter to the next standard DN.',
      v, 'm/s', warnThresh
    );
  }
};

const LOW_VELOCITY = {
  id: 'LOW_VELOCITY',
  category: 'physics',
  requiresSnapshot: true,
  evaluate(comp, snapshot, _allComps, node) {
    if (!node || comp.type !== 'pipe') return null;
    const v = node.velocity_ms;
    if (!isFinite(v) || v <= 0) return null;
    if (v >= 0.5) return null;
    return result(
      'LOW_VELOCITY', 'physics', 'info',
      comp.id, comp.name,
      'Velocity below minimum recommended range',
      `Current velocity ${v.toFixed(3)} m/s is below 0.5 m/s. Risk of sedimentation or biofilm growth.`,
      'Reduce pipe diameter or increase flow rate.',
      v, 'm/s', 0.5
    );
  }
};

const LAMINAR_FLOW = {
  id: 'LAMINAR_FLOW',
  category: 'physics',
  requiresSnapshot: true,
  evaluate(comp, _snapshot, _allComps, node) {
    if (!node || comp.type !== 'pipe') return null;
    const Re = node.Re;
    if (!isFinite(Re)) return null;
    if (Re >= 2300) return null;
    return result(
      'LAMINAR_FLOW', 'physics', 'warning',
      comp.id, comp.name,
      'Laminar flow regime detected',
      `Reynolds number ${Math.round(Re)} < 2300 — laminar flow. Poor heat transfer and mixing performance.`,
      'Increase flow velocity or reduce fluid viscosity to achieve turbulent flow.',
      Re, '', 2300
    );
  }
};

const TRANSITIONAL_FLOW = {
  id: 'TRANSITIONAL_FLOW',
  category: 'physics',
  requiresSnapshot: true,
  evaluate(comp, _snapshot, _allComps, node) {
    if (!node || comp.type !== 'pipe') return null;
    const Re = node.Re;
    if (!isFinite(Re)) return null;
    if (Re < 2300 || Re >= 4000) return null;
    return result(
      'TRANSITIONAL_FLOW', 'physics', 'info',
      comp.id, comp.name,
      'Transitional flow regime',
      `Reynolds number ${Math.round(Re)} is in the transitional range (2300–4000). Flow behavior is unstable.`,
      null,
      Re, '', 4000
    );
  }
};

const NEGATIVE_PRESSURE = {
  id: 'NEGATIVE_PRESSURE',
  category: 'physics',
  requiresSnapshot: true,
  evaluate(comp, _snapshot, _allComps, node) {
    if (!node) return null;
    const P = node.P_out_Pa;
    if (!isFinite(P) || P >= 0) return null;
    return result(
      'NEGATIVE_PRESSURE', 'physics', 'critical',
      comp.id, comp.name,
      'Negative outlet pressure detected',
      `Outlet pressure ${(P / 100000).toFixed(3)} bar at ${comp.name}. Cavitation and system damage risk.`,
      'Increase pump head, reduce system resistance, or raise suction pressure.',
      P, 'Pa', 0
    );
  }
};

const VALVE_NEARLY_CLOSED = {
  id: 'VALVE_NEARLY_CLOSED',
  category: 'physics',
  requiresSnapshot: true,
  evaluate(comp, _snapshot, _allComps, node) {
    if (comp.type !== 'valve') return null;
    const opening = comp.resolve('opening_pct') ?? 100;
    const openingFrac = opening / 100;
    if (openingFrac >= 0.15) return null;
    // Only flag when there is actual flow
    const v = node?.velocity_ms;
    if (isFinite(v) && v <= 0.01) return null;
    return result(
      'VALVE_NEARLY_CLOSED', 'physics', 'warning',
      comp.id, comp.name,
      'Valve nearly closed with active flow',
      `${comp.name} opening is ${opening.toFixed(0)}% (< 15%) while flow is present. High pressure drop and potential control instability.`,
      'Use a control valve for throttling duties, or check if this valve should be fully open.',
      openingFrac, '', 0.15
    );
  }
};

const HIGH_MINOR_LOSS = {
  id: 'HIGH_MINOR_LOSS',
  category: 'physics',
  requiresSnapshot: true,
  evaluate(comp, _snapshot, _allComps, node) {
    if (!node) return null;
    const K = node.K;
    if (!isFinite(K) || K <= 10) return null;
    return result(
      'HIGH_MINOR_LOSS', 'physics', 'warning',
      comp.id, comp.name,
      'Disproportionately high minor loss coefficient',
      `${comp.name} K = ${K.toFixed(1)} — exceeds 10. This component dominates system resistance.`,
      'Verify valve or fitting selection. Consider a lower-resistance alternative.',
      K, '', 10
    );
  }
};

// ===========================================================================
// CATEGORY B — System Level  (systemLevel: true, requiresSnapshot: true)
// ===========================================================================

const LOW_PRESSURE_HEADROOM = {
  id: 'LOW_PRESSURE_HEADROOM',
  category: 'system',
  systemLevel: true,
  requiresSnapshot: true,
  evaluate(snapshot, allComps) {
    if (!snapshot?.nodes?.length) return null;
    const pump = allComps[0];
    if (!pump) return null;
    const shutoffHead_m = pump.resolve('head_m') * 1.2; // approximate shutoff ~120% of nominal
    const shutoffPa = shutoffHead_m * (snapshot.fluid?.rho ?? 1000) * 9.81;

    const totalDeltaP = snapshot.nodes.reduce((sum, n) => sum + (isFinite(n.dP_Pa) ? n.dP_Pa : 0), 0);
    if (shutoffPa <= 0) return null;
    const ratio = totalDeltaP / shutoffPa;
    if (ratio <= 0.85) return null;

    return result(
      'LOW_PRESSURE_HEADROOM', 'system', 'warning',
      null, null,
      'System pressure drop close to pump shutoff head',
      `Total system ΔP ${(totalDeltaP / 100000).toFixed(2)} bar is ${(ratio * 100).toFixed(0)}% of estimated shutoff head. Low operating margin.`,
      'Reduce system resistance or select a pump with higher shutoff pressure.',
      ratio, '', 0.85
    );
  }
};

const CONSECUTIVE_GLOBE_VALVES = {
  id: 'CONSECUTIVE_GLOBE_VALVES',
  category: 'system',
  systemLevel: true,
  requiresSnapshot: false,
  evaluate(_snapshot, allComps) {
    for (let i = 0; i < allComps.length - 1; i++) {
      const a = allComps[i];
      const b = allComps[i + 1];
      if (a.type === 'valve' && a.resolve('subtype') === 'globe' &&
          b.type === 'valve' && b.resolve('subtype') === 'globe') {
        return result(
          'CONSECUTIVE_GLOBE_VALVES', 'system', 'warning',
          null, null,
          'Consecutive globe valves detected',
          `${a.name} and ${b.name} are consecutive globe valves. Combined K is unnecessarily high.`,
          'Replace one globe valve with a gate or ball valve, or consolidate into a single control valve.',
          2, 'globe valves', 1
        );
      }
    }
    return null;
  }
};

const SHORT_PIPE_AFTER_PUMP = {
  id: 'SHORT_PIPE_AFTER_PUMP',
  category: 'system',
  systemLevel: true,
  requiresSnapshot: false,
  evaluate(_snapshot, allComps) {
    if (allComps.length < 2) return null;
    const pump = allComps[0];
    const next = allComps[1];
    if (next.type !== 'pipe') return null;
    const length_m  = next.resolve('length_m');
    const diameter_m = (next.resolve('diameter_mm') ?? 50) / 1000;
    if (!isFinite(length_m) || !isFinite(diameter_m)) return null;
    const minLength = 5 * diameter_m;
    if (length_m >= minLength) return null;
    return result(
      'SHORT_PIPE_AFTER_PUMP', 'system', 'info',
      next.id, next.name,
      'Pipe after pump is shorter than 5× DN',
      `${next.name} length ${length_m.toFixed(2)} m < ${minLength.toFixed(2)} m (5× DN). Flow profile may not be fully developed at the first fitting.`,
      'Extend the first pipe segment to at least 5× the pipe diameter.',
      length_m, 'm', minLength
    );
  }
};

const FLASH_RISK = {
  id: 'FLASH_RISK',
  category: 'system',
  systemLevel: true,
  requiresSnapshot: true,
  evaluate(snapshot, _allComps) {
    if (!snapshot?.nodes?.length) return null;
    const THRESHOLD_PA = 50000; // 0.5 bar abs
    let minP = Infinity;
    for (const n of snapshot.nodes) {
      if (isFinite(n.P_out_Pa) && n.P_out_Pa < minP) minP = n.P_out_Pa;
    }
    if (minP >= THRESHOLD_PA) return null;
    return result(
      'FLASH_RISK', 'system', 'critical',
      null, null,
      'Flash / cavitation risk — pressure below 0.5 bar',
      `Minimum system pressure ${(minP / 100000).toFixed(3)} bar is below the 0.5 bar flash risk threshold. Liquid may vaporise.`,
      'Increase system backpressure or reduce resistance upstream of the low-pressure point.',
      minP, 'Pa', THRESHOLD_PA
    );
  }
};

// ===========================================================================
// CATEGORY C — Pump Performance  (requiresSnapshot: true)
// ===========================================================================

const BEP_DEVIATION_WARNING = {
  id: 'BEP_DEVIATION_WARNING',
  category: 'pump',
  requiresSnapshot: true,
  evaluate(comp, snapshot, _allComps, node) {
    if (comp.type !== 'pump') return null;
    const Q_op  = snapshot?.Q_m3s;
    const Q_nom = comp.resolve('Q_m3s');
    if (!isFinite(Q_op) || !isFinite(Q_nom) || Q_nom <= 0) return null;
    const dev = Math.abs((Q_op - Q_nom) / Q_nom);
    if (dev <= 0.20 || dev > 0.30) return null;
    return result(
      'BEP_DEVIATION_WARNING', 'pump', 'warning',
      comp.id, comp.name,
      'Operating flow deviating from BEP (20–30%)',
      `Current flow ${(Q_op * 1000 * 60).toFixed(1)} L/min — BEP ${(Q_nom * 1000 * 60).toFixed(1)} L/min. Deviation: ${(dev * 100).toFixed(0)}%.`,
      'Operating away from BEP increases vibration and reduces pump life.',
      dev, '', 0.20
    );
  }
};

const BEP_DEVIATION_CRITICAL = {
  id: 'BEP_DEVIATION_CRITICAL',
  category: 'pump',
  requiresSnapshot: true,
  evaluate(comp, snapshot, _allComps, _node) {
    if (comp.type !== 'pump') return null;
    const Q_op  = snapshot?.Q_m3s;
    const Q_nom = comp.resolve('Q_m3s');
    if (!isFinite(Q_op) || !isFinite(Q_nom) || Q_nom <= 0) return null;
    const dev = Math.abs((Q_op - Q_nom) / Q_nom);
    if (dev <= 0.30) return null;
    return result(
      'BEP_DEVIATION_CRITICAL', 'pump', 'critical',
      comp.id, comp.name,
      'Operating flow severely deviating from BEP (>30%)',
      `Current flow ${(Q_op * 1000 * 60).toFixed(1)} L/min — BEP ${(Q_nom * 1000 * 60).toFixed(1)} L/min. Deviation: ${(dev * 100).toFixed(0)}%. High risk of cavitation and mechanical damage.`,
      'Consider pump reselection for the actual operating point.',
      dev, '', 0.30
    );
  }
};

const LOW_EFFICIENCY = {
  id: 'LOW_EFFICIENCY',
  category: 'pump',
  requiresSnapshot: true,
  evaluate(comp, _snapshot, _allComps, _node) {
    if (comp.type !== 'pump') return null;
    const eff = comp.resolve('efficiency'); // 0–1
    if (!isFinite(eff) || eff >= 0.70) return null;
    return result(
      'LOW_EFFICIENCY', 'pump', 'warning',
      comp.id, comp.name,
      'Pump efficiency below 70%',
      `Current efficiency ${(eff * 100).toFixed(0)}% — threshold 70%. High operating cost and heat generation.`,
      'Verify impeller condition or select a higher-efficiency pump for this duty point.',
      eff, '', 0.70
    );
  }
};

const NEAR_DEADHEAD = {
  id: 'NEAR_DEADHEAD',
  category: 'pump',
  requiresSnapshot: true,
  evaluate(comp, snapshot, _allComps, _node) {
    if (comp.type !== 'pump') return null;
    const Q_op  = snapshot?.Q_m3s;
    const Q_nom = comp.resolve('Q_m3s');
    if (!isFinite(Q_op) || !isFinite(Q_nom) || Q_nom <= 0) return null;
    if (Q_op <= 0) return null; // actual deadhead → alarm system handles it
    const ratio = Q_op / Q_nom;
    if (ratio >= 0.10) return null;
    return result(
      'NEAR_DEADHEAD', 'pump', 'warning',
      comp.id, comp.name,
      'Flow approaching deadhead condition',
      `Current flow ${(Q_op * 1000 * 60).toFixed(2)} L/min is ${(ratio * 100).toFixed(1)}% of nominal — near deadhead.`,
      'Open downstream isolation valves or check for blockage.',
      ratio, '', 0.10
    );
  }
};

const NEAR_SHUTOFF = {
  id: 'NEAR_SHUTOFF',
  category: 'pump',
  requiresSnapshot: true,
  evaluate(comp, snapshot, _allComps, node) {
    if (comp.type !== 'pump') return null;
    const H_op = node?.H_m ?? snapshot?.H_m;
    const H_shutoff = comp.resolve('head_m') * 1.2; // approximate shutoff
    if (!isFinite(H_op) || !isFinite(H_shutoff) || H_shutoff <= 0) return null;
    const ratio = H_op / H_shutoff;
    if (ratio <= 0.90) return null;
    return result(
      'NEAR_SHUTOFF', 'pump', 'warning',
      comp.id, comp.name,
      'Pump operating near shutoff head',
      `Current head ${H_op.toFixed(1)} m is ${(ratio * 100).toFixed(0)}% of estimated shutoff head ${H_shutoff.toFixed(1)} m.`,
      'Increase flow rate or reduce system resistance.',
      ratio, '', 0.90
    );
  }
};

// ===========================================================================
// CATEGORY D — Configuration  (requiresSnapshot: false)
// ===========================================================================

const DIAMETER_MISMATCH = {
  id: 'DIAMETER_MISMATCH',
  category: 'config',
  requiresSnapshot: false,
  evaluate(comp, _snapshot, allComps, _node) {
    const idx = allComps.indexOf(comp);
    if (idx <= 0) return null;
    const prev = allComps[idx - 1];
    // Skip if there is a transition component between them
    if (comp.type === 'transition') return null;
    if (prev.type === 'transition') return null;

    const dPrev = prev.outDiameter_mm;
    const dComp = comp.type === 'transition' ? comp.resolve('d_in_mm') : comp.resolve('diameter_mm');
    if (!isFinite(dPrev) || !isFinite(dComp)) return null;
    const diff = Math.abs(dPrev - dComp);
    if (diff <= 0.5) return null;

    return result(
      'DIAMETER_MISMATCH', 'config', 'warning',
      comp.id, comp.name,
      'Diameter mismatch without a transition fitting',
      `${prev.name} outlet ${dPrev.toFixed(1)} mm → ${comp.name} inlet ${dComp.toFixed(1)} mm (Δ${diff.toFixed(1)} mm) with no transition component.`,
      'Insert a reducer or expander transition between these components.',
      diff, 'mm', 0.5
    );
  }
};

const LONG_PIPE_SEGMENT = {
  id: 'LONG_PIPE_SEGMENT',
  category: 'config',
  requiresSnapshot: false,
  evaluate(comp, _snapshot, _allComps, _node) {
    if (comp.type !== 'pipe') return null;
    const L = comp.resolve('length_m');
    if (!isFinite(L) || L <= 100) return null;
    return result(
      'LONG_PIPE_SEGMENT', 'config', 'info',
      comp.id, comp.name,
      'Single pipe segment longer than 100 m',
      `${comp.name} is ${L.toFixed(0)} m long. Verify this is a single straight run — otherwise split into segments for accurate elevation modelling.`,
      null,
      L, 'm', 100
    );
  }
};

const STEEP_TRANSITION = {
  id: 'STEEP_TRANSITION',
  category: 'config',
  requiresSnapshot: false,
  evaluate(comp, _snapshot, _allComps, _node) {
    if (comp.type !== 'transition') return null;
    const d_in  = comp.resolve('d_in_mm');
    const d_out = comp.resolve('d_out_mm');
    const L_m   = comp.resolve('length_m');
    if (!isFinite(d_in) || !isFinite(d_out) || !isFinite(L_m) || L_m <= 0) return null;
    const angle = Math.atan(Math.abs(d_out - d_in) / (2 * L_m * 1000)) * (180 / Math.PI);
    if (angle <= 15) return null;
    return result(
      'STEEP_TRANSITION', 'config', 'warning',
      comp.id, comp.name,
      'Transition cone angle exceeds 15°',
      `${comp.name} cone half-angle ${angle.toFixed(1)}° — exceeds 15°. High turbulent separation losses expected.`,
      'Increase transition length or use a gradual reducer to reduce cone angle.',
      angle, '°', 15
    );
  }
};

// CATEGORY E — Advice  (severity always 'info', depends on pass-1 results)

const SUGGEST_LARGER_DN = {
  id: 'SUGGEST_LARGER_DN',
  category: 'advice',
  requiresSnapshot: true,
  // Called in pass-2 — receives interim results list
  evaluateAdvice(pass1Results, allComps) {
    const highVelResults = pass1Results.filter(r => r.id === 'HIGH_VELOCITY');
    const suggestions = [];
    for (const hv of highVelResults) {
      const comp = allComps.find(c => c.id === hv.componentId);
      if (!comp) continue;
      const d = comp.resolve('diameter_mm');
      if (!isFinite(d)) continue;
      const larger = DN_LIST.find(dn => dn > d);
      if (!larger) continue;
      suggestions.push(result(
        'SUGGEST_LARGER_DN', 'advice', 'info',
        comp.id, comp.name,
        `Increase pipe to DN${Math.round(larger)} to reduce velocity`,
        `${comp.name} has high velocity. Upgrading from ${d.toFixed(0)} mm to ${larger.toFixed(0)} mm (next standard DN) would significantly reduce velocity.`,
        `Replace with DN${Math.round(larger)} pipe.`,
        larger, 'mm', d
      ));
    }
    return suggestions;
  }
};

const SUGGEST_CONTROL_VALVE = {
  id: 'SUGGEST_CONTROL_VALVE',
  category: 'advice',
  requiresSnapshot: true,
  evaluateAdvice(pass1Results, allComps) {
    const suggestions = [];
    for (const comp of allComps) {
      if (comp.type !== 'valve') continue;
      const opening = comp.resolve('opening_pct') ?? 100;
      if (opening >= 20) continue;
      const subtype = comp.resolve('subtype') ?? '';
      if (subtype === 'globe') continue; // already a control-type valve
      suggestions.push(result(
        'SUGGEST_CONTROL_VALVE', 'advice', 'info',
        comp.id, comp.name,
        'Control valve recommended for throttling duty',
        `${comp.name} (${subtype}) is operating at ${opening.toFixed(0)}% opening. A globe or butterfly control valve is better suited for throttling.`,
        'Replace with a globe or butterfly control valve sized for this flow range.',
        opening / 100, '', 0.20
      ));
    }
    return suggestions;
  }
};

const SUGGEST_PUMP_RESELECTION = {
  id: 'SUGGEST_PUMP_RESELECTION',
  category: 'advice',
  requiresSnapshot: true,
  evaluateAdvice(pass1Results, allComps) {
    const hasBepCritical = pass1Results.some(r => r.id === 'BEP_DEVIATION_CRITICAL');
    if (!hasBepCritical) return [];
    const pump = allComps.find(c => c.type === 'pump');
    if (!pump) return [];
    return [result(
      'SUGGEST_PUMP_RESELECTION', 'advice', 'info',
      pump.id, pump.name,
      'Pump reselection recommended',
      `Operating point deviates critically from BEP. Current pump curve is not matched to system requirements.`,
      'Consult pump manufacturer for a curve matched to the actual operating flow and head.',
      null, null, null
    )];
  }
};

// Exports

// Component-level rules (evaluated per-component in a loop)
export const COMPONENT_RULES = [
  HIGH_VELOCITY,
  LOW_VELOCITY,
  LAMINAR_FLOW,
  TRANSITIONAL_FLOW,
  NEGATIVE_PRESSURE,
  VALVE_NEARLY_CLOSED,
  HIGH_MINOR_LOSS,
  BEP_DEVIATION_WARNING,
  BEP_DEVIATION_CRITICAL,
  LOW_EFFICIENCY,
  NEAR_DEADHEAD,
  NEAR_SHUTOFF,
  DIAMETER_MISMATCH,
  LONG_PIPE_SEGMENT,
  STEEP_TRANSITION,
];

// System-level rules (evaluated once, not per-component)
export const SYSTEM_RULES = [
  LOW_PRESSURE_HEADROOM,
  CONSECUTIVE_GLOBE_VALVES,
  SHORT_PIPE_AFTER_PUMP,
  FLASH_RISK,
];

// Advice rules — pass-2, depend on pass-1 results
export const ADVICE_RULES = [
  SUGGEST_LARGER_DN,
  SUGGEST_CONTROL_VALVE,
  SUGGEST_PUMP_RESELECTION,
];