import type { RouteNode } from '@aurelia/router'

/**
 * The route node a route's `loading(params, next)` hook receives, carrying
 * only the query string the screen reads (`?stock=`, `?sale=`).
 */
export function routeNodeWithQuery(query: Record<string, string>): RouteNode {
	return { queryParams: new URLSearchParams(query) } as unknown as RouteNode
}
