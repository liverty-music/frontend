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
}

const BASE_RADIUS = 60
const GROWTH_PER_FOLLOW = 8
const LINEAR_STEPS = 6
const MAX_RADIUS = 120
const MAX_ORBITALS = 12

export function getStageParams(followCount: number): StageParams {
	const level = followCount

	// Orb radius: linear for 0-6, logarithmic tail for 7+
	let orbRadius: number
	if (followCount <= LINEAR_STEPS) {
		orbRadius = BASE_RADIUS + followCount * GROWTH_PER_FOLLOW
	} else {
		const linearMax = BASE_RADIUS + LINEAR_STEPS * GROWTH_PER_FOLLOW
		orbRadius = linearMax + Math.log2(followCount - LINEAR_STEPS + 1) * 8
	}
	orbRadius = Math.min(MAX_RADIUS, orbRadius)

	// Breathing pulse
	const breathAmplitude =
		followCount > 0 ? Math.min(0.05, 0.01 + followCount * 0.008) : 0
	const breathSpeed = 1.5 + Math.min(followCount, 10) * 0.15

	// Orbital particles: appear at 2, max 12
	let orbitalCount: number
	if (followCount < 2) {
		orbitalCount = 0
	} else {
		orbitalCount = Math.min(MAX_ORBITALS, (followCount - 1) * 2)
	}
	const orbitalSpeedMultiplier = 1 + Math.min(followCount, 10) * 0.1

	// Light rays: appear at 4
	let lightRayCount: number
	if (followCount < 4) {
		lightRayCount = 0
	} else {
		lightRayCount = Math.min(6, (followCount - 3) * 2)
	}
	const lightRayAlpha =
		followCount >= 4 ? Math.min(0.15, 0.05 + (followCount - 4) * 0.025) : 0
	const lightRayRotationSpeed = 0.1 + Math.min(followCount, 10) * 0.02

	// Ground glow: appears at 2
	const groundGlowAlpha =
		followCount >= 2 ? Math.min(0.2, (followCount - 1) * 0.03) : 0

	// Shockwave: enabled at 5+
	const shockwaveEnabled = followCount >= 5

	// Comet trail: enabled at 4+
	const cometTrailEnabled = followCount >= 4

	// Outer glow alpha
	const glowAlpha = 0.1 + Math.min(1, followCount / 6) * 0.3

	// Particle visibility
	const particleVisibilityRatio =
		followCount > 0 ? Math.min(1, 0.3 + followCount * 0.12) : 0.1

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
	}
}
