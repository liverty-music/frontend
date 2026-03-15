export interface StageParams {
	level: number
	orbRadius: number
	breathAmplitude: number
	breathSpeed: number
	orbitalCount: number
	orbitalSpeedMultiplier: number
	lightRayCount: number
	lightRayAlpha: number
	lightRayRotationSpeed: number
	groundGlowAlpha: number
	shockwaveEnabled: boolean
	cometTrailEnabled: boolean
	glowAlpha: number
	particleVisibilityRatio: number
	nebulaLayerCount: number
	nebulaAlpha: number
	vortexTrailLength: number
	beatBPM: number
	strobeEnabled: boolean
	orbitalTailArc: number
	orbitalSize: number
	lightRayWidthMin: number
	lightRayWidthMax: number
}

const BASE_RADIUS = 60
const GROWTH_PER_FOLLOW = 12
const LINEAR_STEPS = 5
const MAX_RADIUS = 120
const MAX_ORBITALS = 12
const MAX_LIGHT_RAYS = 14
const FULL_SHOW = 5

export function getStageParams(followCount: number): StageParams {
	const level = followCount
	const fc = followCount

	// Orb radius: linear for 0-5, logarithmic tail for 6+
	let orbRadius: number
	if (fc <= LINEAR_STEPS) {
		orbRadius = BASE_RADIUS + fc * GROWTH_PER_FOLLOW
	} else {
		const linearMax = BASE_RADIUS + LINEAR_STEPS * GROWTH_PER_FOLLOW
		orbRadius = linearMax + Math.log2(fc - LINEAR_STEPS + 1) * 8
	}
	orbRadius = Math.min(MAX_RADIUS, orbRadius)

	// Breathing pulse
	const breathAmplitude = fc > 0 ? Math.min(0.05, 0.01 + fc * 0.01) : 0
	const breathSpeed = 1.5 + Math.min(fc, FULL_SHOW) * 0.3

	// Orbital particles: appear at 1, max 12 at 5
	let orbitalCount: number
	if (fc < 1) {
		orbitalCount = 0
	} else {
		orbitalCount = Math.min(MAX_ORBITALS, fc * 3 - 1)
	}
	const orbitalSpeedMultiplier = 1 + Math.min(fc, FULL_SHOW) * 0.2

	// Light rays: appear at 2, max 14 at 5
	let lightRayCount: number
	if (fc < 2) {
		lightRayCount = 0
	} else {
		lightRayCount = Math.min(MAX_LIGHT_RAYS, (fc - 1) * 4 - 2)
	}
	const lightRayAlpha = fc >= 2 ? Math.min(0.4, 0.1 + (fc - 2) * 0.1) : 0
	const lightRayRotationSpeed = 0.3 + Math.min(fc, FULL_SHOW) * 0.1
	const lightRayWidthMin = 0.08
	const lightRayWidthMax =
		fc >= 2 ? Math.min(0.25, 0.12 + (fc - 2) * 0.04) : 0.08

	// Ground glow: appears at 1
	const groundGlowAlpha = fc >= 1 ? Math.min(0.2, fc * 0.04) : 0

	// Shockwave: enabled at 3+
	const shockwaveEnabled = fc >= 3

	// Comet trail: enabled at 3+
	const cometTrailEnabled = fc >= 3

	// Strobe: enabled at 3+
	const strobeEnabled = fc >= 3

	// Outer glow alpha
	const glowAlpha = 0.1 + Math.min(1, fc / FULL_SHOW) * 0.3

	// Particle visibility
	const particleVisibilityRatio = fc > 0 ? Math.min(1, 0.3 + fc * 0.15) : 0.1

	// Nebula: appears at 2, max 3 layers at 4
	let nebulaLayerCount: number
	if (fc < 2) {
		nebulaLayerCount = 0
	} else {
		nebulaLayerCount = Math.min(3, fc - 1)
	}
	const nebulaAlpha = fc >= 2 ? Math.min(0.25, 0.08 + (fc - 2) * 0.06) : 0

	// Vortex trails: appear at 1, max length 6 at 3
	const vortexTrailLength = fc >= 1 ? Math.min(6, fc * 2) : 0

	// Beat sync: appears at 2, max BPM 2.0 at 5
	const beatBPM = fc >= 2 ? Math.min(2.0, 0.8 + (fc - 2) * 0.4) : 0

	// Orbital tail arc: appears at 2, max 45 degrees at 4
	const orbitalTailArc = fc >= 2 ? Math.min(45, (fc - 1) * 15) : 0

	// Orbital size: 2 at 0, 4 at 1, up to 8 at 4+
	const orbitalSize = fc >= 1 ? Math.min(8, 2 + fc * 2) : 2

	return {
		level,
		orbRadius,
		breathAmplitude,
		breathSpeed,
		orbitalCount,
		orbitalSpeedMultiplier,
		lightRayCount,
		lightRayAlpha,
		lightRayRotationSpeed,
		groundGlowAlpha,
		shockwaveEnabled,
		cometTrailEnabled,
		glowAlpha,
		particleVisibilityRatio,
		nebulaLayerCount,
		nebulaAlpha,
		vortexTrailLength,
		beatBPM,
		strobeEnabled,
		orbitalTailArc,
		orbitalSize,
		lightRayWidthMin,
		lightRayWidthMax,
	}
}
