import { DI, type IContainer, ILogger, Registration } from 'aurelia'
import { createMockLogger } from './mock-logger'

/**
 * Creates a test DI container with ILogger pre-registered.
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

	// Register any additional dependencies
	for (const registration of registrations) {
		container.register(registration)
	}

	return container
}
