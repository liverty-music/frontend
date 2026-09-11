import { Code, ConnectError } from '@connectrpc/connect'
import { describe, expect, it } from 'vitest'
import {
	classifyRpcOutcome,
	RpcTelemetryRecorder,
} from '../../../src/lib/analytics/rpc-telemetry'

describe('classifyRpcOutcome', () => {
	it('maps a DeadlineExceeded ConnectError to deadline_exceeded', () => {
		expect(
			classifyRpcOutcome(new ConnectError('deadline', Code.DeadlineExceeded)),
		).toBe('deadline_exceeded')
	})

	it('maps a Canceled ConnectError to canceled', () => {
		expect(classifyRpcOutcome(new ConnectError('c', Code.Canceled))).toBe(
			'canceled',
		)
	})

	it('maps an AbortError DOMException to canceled', () => {
		expect(classifyRpcOutcome(new DOMException('aborted', 'AbortError'))).toBe(
			'canceled',
		)
	})

	it('maps any other ConnectError code to error', () => {
		expect(classifyRpcOutcome(new ConnectError('x', Code.Unavailable))).toBe(
			'error',
		)
	})

	it('maps a non-ConnectError to error', () => {
		expect(classifyRpcOutcome(new TypeError('network'))).toBe('error')
	})
})

describe('RpcTelemetryRecorder', () => {
	// Deterministic clock so windowMs is assertable.
	function recorderWithClock(times: number[]): RpcTelemetryRecorder {
		let i = 0
		return new RpcTelemetryRecorder(
			() => times[Math.min(i++, times.length - 1)],
		)
	}

	it('is empty until a call is recorded', () => {
		const r = new RpcTelemetryRecorder(() => 0)
		expect(r.pending).toBe(false)
		expect(r.drain()).toBeNull()
	})

	it('places durations in the expected latency buckets', () => {
		const r = new RpcTelemetryRecorder(() => 0)
		r.record('S/A', 30, 'ok') // <= 50
		r.record('S/A', 150, 'ok') // <= 250
		r.record('S/A', 9000, 'ok') // <= 10000
		r.record('S/A', 20000, 'deadline_exceeded') // overflow

		const snap = r.drain()
		expect(snap).not.toBeNull()
		expect(snap?.buckets).toEqual({
			'50': 1,
			'250': 1,
			'10000': 1,
			overflow: 1,
		})
	})

	it('counts terminal outcomes and per-method tallies', () => {
		const r = new RpcTelemetryRecorder(() => 0)
		r.record('User/Get', 10, 'ok')
		r.record('User/Get', 10, 'deadline_exceeded')
		r.record('Artist/List', 10, 'canceled')
		r.record('Artist/List', 10, 'error')

		const snap = r.drain()
		expect(snap?.total).toBe(4)
		expect(snap?.outcomes).toEqual({
			ok: 1,
			deadline_exceeded: 1,
			canceled: 1,
			error: 1,
		})
		// method -> [total, deadlineExceeded]
		expect(snap?.methods).toEqual({
			'User/Get': [2, 1],
			'Artist/List': [2, 0],
		})
	})

	it('reports the window duration from the injected clock', () => {
		const r = recorderWithClock([1000, 4000]) // start=1000, drain=4000
		r.record('S/A', 5, 'ok')
		expect(r.drain()?.windowMs).toBe(3000)
	})

	it('resets after drain so the next window starts empty', () => {
		const r = new RpcTelemetryRecorder(() => 0)
		r.record('S/A', 5, 'ok')
		expect(r.drain()?.total).toBe(1)
		expect(r.pending).toBe(false)
		expect(r.drain()).toBeNull()
	})
})
