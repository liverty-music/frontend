import { I18N } from '@aurelia/i18n'
import { DI, type IContainer, ILogger, Registration } from 'aurelia'
import { createMockI18n } from './mock-i18n'
import { createMockLogger } from './mock-logger'

/**
 * Creates a test DI container with ILogger and I18N pre-registered.
 * Additional registrations can be passed in.
 *
 * @param registrations - Optional additional DI registrations
 * @returns Configured DI container for testing
 */
export function createTestContainer(
	...registrations: Parameters<IContainer['register']>[0][]
): IContainer {
	const container = DI.createContainer()

	// Pre-register a mock logger
	container.register(Registration.instance(ILogger, createMockLogger()))

	// Pre-register a mock I18N service
	container.register(Registration.instance(I18N, createMockI18n()))

	// Register any additional dependencies
	for (const registration of registrations) {
		container.register(registration)
	}

	return container
}
