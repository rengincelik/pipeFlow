# PipeFlow — Pipeline Flow Simulator

> **[▶ Open Live Demo](https://rengincelik.github.io/pipeFlow/)**

A browser-based, real-time pipeline hydraulics simulator for process engineers.  
No installation. No login. Drag, drop, simulate.

---

## For Engineers

### Physical Model

**Flow calculation** uses the continuity equation. Flow rate (Q) is conserved along the pipeline; velocity updates automatically at diameter changes.

**Major losses** — Darcy-Weisbach equation:

```
ΔP = f · (L/D) · ½ρv²
```

Friction factor (f): `f = 64/Re` in laminar flow; Colebrook-White iteration in turbulent flow (Newton-Raphson, max 50 iterations, tolerance 1×10⁻⁶).

**Minor losses** — K-coefficient method:

```
ΔP = K · ½ρv²
```

K values: angle-dependent for elbows; type + opening-dependent for valves (Crane TP-410 lookup table + linear interpolation).

**Transitions (reducer / expander):**
- Expander → Borda-Carnot: `ΔP_loss = ½ρ(v₁−v₂)²`
- Reducer → contraction coefficient: `Kc ≈ 0.5·(1 − (D₂/D₁)²)`
- Bernoulli pressure recovery / loss included in both cases

**Flow regime** by Reynolds number:

| Re | Regime |
|----|--------|
| < 2 300 | Laminar |
| 2 300 – 4 000 | Transitional |
| > 4 000 | Turbulent |

**Fluid model** — empirical polynomial coefficients. Density (ρ) is a polynomial function of temperature; dynamic viscosity (μ) uses the Vogel equation.

| Fluid | Range |
|-------|-------|
| Water | 0 – 150 °C |
| Ethylene Glycol 50% (EG50) | −30 – 120 °C |

**Pump model** — H-Q curve fitted from three operating points (shutoff, nominal, max flow) using a 2nd-degree polynomial. Operating point solved each tick via bisection. Smooth-step ramp at startup (2 s). Deadhead protection: overload alarm after 5 s of zero flow.

**PRV (Pressure Relief Valve)** — iterative K-model. Inner convergence loop adjusts K each tick to match the downstream set pressure.

### Supported Components

| Component | Calculation Method |
|-----------|-------------------|
| Pump | H-Q polynomial → bisection operating point |
| Pipe | Darcy-Weisbach + Colebrook-White |
| Elbow | K-coefficient (angle-dependent: RD, RU, UR, DR) |
| Reducer | Contraction loss + Bernoulli |
| Expander | Borda-Carnot + Bernoulli |
| Gate Valve | Crane TP-410 K-table, partial opening |
| Ball Valve | Crane TP-410 K-table, partial opening |
| Butterfly Valve | Crane TP-410 K-table, partial opening |
| Globe Valve | Crane TP-410 K-table, partial opening |
| Check Valve | Fixed K, full-open only |
| PRV | Iterative K-model, set pressure target |

### Alarm System

| Code | Level | Trigger |
|------|-------|---------|
| `DEADHEAD` | warning → critical | Pump running, flow = 0 for > 5 s |
| `NEGATIVE_PRESSURE` | warning | P < 0 at any node (cavitation risk) |
| `HIGH_VELOCITY` | info | Pipe velocity > 3 m/s |
| `CONVERGENCE_FAILURE` | warning | Bisection did not converge |

Warnings and critical alarms stop the simulation. Info alarms pass silently.

### Diagnostics System

Runs in parallel with the alarm system — analyses the hydraulic state without stopping the simulation.

**21 rules across 5 categories:**

| Category | Rules |
|----------|-------|
| A — Flow & Pressure | High/low velocity, laminar/transitional flow, negative pressure, nearly-closed valve, high minor loss |
| B — System Layout | Low pressure headroom, consecutive globe valves, short pipe after pump, flash risk |
| C — Pump Health | BEP deviation (warning / critical), low efficiency, near deadhead, near shutoff |
| D — Configuration | Diameter mismatch, long pipe segment, steep transition |
| E — Advice | Suggest larger DN, suggest control valve, suggest pump reselection |

Results appear in the **Diagnostics** tab inside the Analysis panel. Clicking a result selects the relevant component on the canvas.

### Industry Thresholds

| Parameter | Green | Yellow | Red |
|-----------|-------|--------|-----|
| Pipe velocity (water) | 0.5 – 2.5 m/s | 2.5 – 3.5 m/s | > 3.5 m/s |
| Pipe velocity (viscous) | 0.3 – 1.5 m/s | 1.5 – 2.5 m/s | > 2.5 m/s |
| Reynolds number | > 10 000 | 4 000 – 10 000 | < 4 000 |
| Pump efficiency | > 70 % | 50 – 70 % | < 50 % |
| BEP deviation | ± 20 % | ± 30 % | > ± 30 % |
| Node pressure | > 0.5 bar | 0 – 0.5 bar | < 0 bar |

---

## For Users

### Building a Pipeline

1. Select a component from the left panel (Catalog)
2. Drag and drop it onto the canvas — or double-click to append at the end
3. Components connect automatically; diameter mismatches are flagged with a `!` indicator
4. The pump is always at the start of the pipeline and cannot be removed

### Component Settings

Click any component to open its parameters in the Properties panel. Fields left blank use the system default. Only enter values where you need something different from the default.

### Running the Simulation

Press **START**. The pump ramps to full speed over 2 seconds.

While running you can:
- Adjust valve opening → results update on the next tick (100 ms)
- Click a component → its bar is highlighted in the chart
- Watch the Diagnostics tab for hydraulic advice in real time

Pressing **STOP** resets the timer and volume counter.

### Reading the Analysis Panel

**Chart tab** — two panels side by side:
- Left: stacked bar chart — pressure drop per component (major loss + minor loss)
- Right: 60-second time-series — selected metric over time

Available metrics: ΔP · Pressure · Velocity · Flow

**Diagnostics tab** — live hydraulic analysis. Each item shows severity (critical / warning / info), the affected component, and an advisory message. Click an item to expand detail and advice; click again to select the component on the canvas.

### Units

Toggle between **SI** and **Imperial** with the units button in the top bar. All internal calculations remain in SI; display conversion is applied at the UI layer only. Input fields always accept metric values.

### Import / Export

- **Export JSON** — saves the current pipeline to a `.json` file
- **Import JSON** — loads a previously exported pipeline
- Projects are also auto-saved to browser localStorage per tab

---

## For Developers

### Stack

- **Vanilla JS (ES Modules)** — no framework, no bundler, no build step
- **SVG** — pipeline canvas, component geometry, layer system
- **Canvas 2D** — chart rendering, flow particle animation
- **requestAnimationFrame** — particle animation loop
- **setInterval (100 ms)** — simulation tick loop

### Architecture (simplified)

```
main.js
├── state/
│   ├── pipeline-store.js     — component CRUD, layout, diameter propagation
│   └── system-config.js      — global defaults, override system
├── components/               — pump, pipe, elbow, transition, valve, prv
├── simulation/
│   └── simulation-engine.js  — state machine, tick loop, H-Q bisection
├── diagnostics/
│   ├── diagnostic-rules.js   — 21 rule objects
│   ├── diagnostic-engine.js  — throttled evaluate(), observer pattern
│   └── diagnostic-panel.js   — runtime DOM patch into Analysis panel
├── renderer/
│   ├── svg-renderer.js       — layout calculation, SVG drawing, layer system
│   ├── chart-renderer.js     — dual-panel Canvas 2D chart
│   ├── flow-animator.js      — continuous particle system, Bézier elbows
│   └── tooltip-manager.js    — hover data, NaN-safe formatting
└── data/
    ├── catalogs.js           — component catalog, DN list, materials
    ├── fluid-model.js        — empirical fluid models (water, EG50)
    └── unit-system.js        — metric / imperial display conversion
```

### Data Flow

```
User interaction
    ↓
PipelineStore  →  SVGRenderer · FlowAnimator · DiagnosticEngine (config rules)

SimulationEngine._tick()  [every 100 ms]
    ↓
DiagnosticEngine.evaluate(snapshot)   ← physics + pump rules
    ↓  onTick(snapshot)
    ├── FlowAnimator.update()
    ├── ChartRenderer.draw()
    └── UI.updateHUD()
```

### Simulation State Machine

```
          start()
IDLE ──────────────→ RUNNING
  ↑                      │ alarm
  └──────── stop() ───────┘
                     ALARM
              (deadhead > 5 s → OVERLOAD)

Pump: STOPPED → RAMPING (0–2 s) → RUNNING → OVERLOAD
```

### Adding a New Component

```javascript
// 1. components/myelem.js
import { ComponentBase, registerComponentType } from './base.js';

class MyElem extends ComponentBase {
  constructor() { super('myelem', 'default'); }

  static get CONSTRAINTS() {
    return { length_m: { min: 0.5, max: 200, step: 0.5, unit: 'm' } };
  }

  getParams() {
    return { type: 'myelem', diameter_mm: this.resolve('diameter_mm') };
  }

  shapeSpec(layout) { /* SVG shape definition */ }
  renderPropsHTML()  { /* Property panel HTML   */ }
}

registerComponentType('myelem', 'default', () => new MyElem());

// 2. Add case to SimulationEngine._tick() switch
// 3. Add entry to CATALOG_DEF in data/catalogs.js
// 4. Add import to imports.js (registration order matters)
```

### Override System

Every component falls back to `SystemConfig` defaults; per-element overrides are supported:

```javascript
comp.resolve('diameter_mm')           // override value, or SystemConfig default
comp.override('diameter_mm', 80)      // system-set (propagation)
comp.override('diameter_mm', 80, true)// user-set (from property panel)
comp.hasOverride('diameter_mm')       // any override present?
comp.hasUserOverride('diameter_mm')   // user-set specifically?
```

Diameter propagation (`propagateDiameterFrom`) skips components where `hasUserOverride('diameter_mm')` is true.

---

## License

MIT