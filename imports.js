// imports.js
'use strict';

// System ve store
import { SystemConfig } from './state/system-config.js';
import { pipelineStore } from './state/pipeline-store.js';

// Renderer
import { SVGRenderer } from './renderer/svg-renderer.js';
import { ChartRenderer } from './renderer/chart-renderer.js';
import { FlowAnimator } from './renderer/flow-animator.js';
import { TooltipManager } from './renderer/tooltip-manager.js';

// Simulation
import { SimulationEngine, SysState } from './Simulation/simulation-engine.js';

// data ve component management
import { Units } from './data/unit-system.js';
import { EmpiricalFluidModel } from './data/fluid-model.js';
import { createComponent } from './components/base.js';
import { createCatalogManager } from './ui/catalog-manager.js';

// Side effect component imports (order matters for registration)
import './components/pipe.js';
import './components/transition.js';
import './components/elbow.js';
import './components/valve.js';
import './components/pump.js';
import './components/prv.js';

// Exports (for main.js )
export {
	SystemConfig,
	pipelineStore,
	SVGRenderer,
	ChartRenderer,
	FlowAnimator,
	TooltipManager,
	SimulationEngine,
	SysState,
	Units,
	EmpiricalFluidModel,
	createComponent,
	createCatalogManager
};