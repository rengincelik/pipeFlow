'use strict';

/**
 * H-Q POLYNOMIAL HELPERS
 * Shared by pump.js and SimulationEngine.js.
 * Decouples Component → Engine import dependency.
 */

/**
 * Fits a second-degree H-Q polynomial using 3 points.
 * Points: (0, H_shutoff), (Q_nom, H_nom), (Q_max, 0)
 * Equation: H(Q) = a0 + a1·Q + a2·Q²
 */
export function fitHQCurve(H_shutoff, Q_nom, H_nom, Q_max) {
	const a0   = H_shutoff;
	const rhs1 = H_nom - a0;
	const rhs2 = -a0;
	const det  = Q_nom * Q_max * Q_max - Q_max * Q_nom * Q_nom;

	if (Math.abs(det) < 1e-12) {
		return { a0: H_shutoff, a1: 0, a2: 0 };
	}

	const a1 = (rhs1 * Q_max * Q_max - rhs2 * Q_nom * Q_nom) / det;
	const a2 = (Q_nom * rhs2 - Q_max * rhs1) / det;

	return { a0, a1, a2 };
}

/**
 * Evaluates the H-Q polynomial at a given Q.
 * Never returns negative head — physically invalid.
 */
export function evalHQ(coeffs, Q) {
	const H = coeffs.a0 + coeffs.a1 * Q + coeffs.a2 * Q * Q;
	return Math.max(0, H);
}