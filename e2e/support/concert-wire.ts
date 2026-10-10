/**
 * Build a ConcertService response body in its wire shape from concerts written
 * with their Series and performers inline.
 *
 * On the wire a Concert is `{ event, artistIds }`, and the response carries each
 * referenced Series and Artist once in `series` and `artists`. Fixtures stay
 * readable by describing each concert as one object — its Event fields, a
 * `series` and `performers` — and passing the body through this function, which
 * moves the Event fields under `event`, the performers to `artistIds`, and
 * collects every Series and Artist once. `concerts`, `concert` and the lanes of
 * `groups` are converted; other fields pass through unchanged.
 */
export function concertWire(
	body: Record<string, unknown>,
): Record<string, unknown> {
	const series = new Map<string, Json>()
	const artists = new Map<string, Json>()

	const toWire = (concert: Json): Json => {
		const s = concert.series as Json | undefined
		const seriesId = idOf(s) ?? `series-of-${idOf(concert) ?? series.size}`
		if (s && !series.has(seriesId)) {
			series.set(seriesId, { ...s, id: { value: seriesId } })
		}
		const performers = (concert.performers as Json[] | undefined) ?? []
		const artistIds: Json[] = []
		for (const p of performers) {
			const id = idOf(p)
			if (!id) continue
			if (!artists.has(id)) artists.set(id, p)
			artistIds.push({ value: id })
		}
		return {
			event: {
				id: concert.id,
				venue: concert.venue,
				localDate: concert.localDate,
				startTime: concert.startTime,
				openTime: concert.openTime,
				listedVenueName: concert.listedVenueName,
				seriesId: { value: seriesId },
			},
			artistIds,
		}
	}

	const out: Record<string, unknown> = { ...body }
	if (Array.isArray(body.concerts)) {
		out.concerts = (body.concerts as Json[]).map(toWire)
	}
	if (body.concert) out.concert = toWire(body.concert as Json)
	if (Array.isArray(body.groups)) {
		out.groups = (body.groups as Json[]).map((g) => ({
			...g,
			home: ((g.home as Json[] | undefined) ?? []).map(toWire),
			nearby: ((g.nearby as Json[] | undefined) ?? []).map(toWire),
			away: ((g.away as Json[] | undefined) ?? []).map(toWire),
		}))
	}
	out.series = [...series.values()]
	out.artists = [...artists.values()]
	return out
}

type Json = Record<string, unknown>

function idOf(message: Json | undefined): string | undefined {
	const id = message?.id as { value?: string } | undefined
	return id?.value || undefined
}
