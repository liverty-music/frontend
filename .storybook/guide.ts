import { Registration } from 'aurelia'
import { IGuideService } from '../src/services/guide-service'

/**
 * A guide moment service that shows nothing, for a story whose component
 * resolves `IGuideService` (a screen that requests a moment, the action menu,
 * the concert sheet) but is not about guide moments. The real service would
 * pull in the analytics service and its app configuration. A story about a
 * moment registers the real one with fakes for those instead
 * (cf. `src/components/guide-line/guide-line.stories.ts`).
 */
export const noGuide = Registration.instance(IGuideService, {
	current: null,
	request() {},
	replay() {},
	acted() {},
	dismiss() {},
	setTarget() {},
})
