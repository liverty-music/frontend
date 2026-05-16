import { I18N } from '@aurelia/i18n'
import { DI, type IContainer, ILogger, Registration } from 'aurelia'
import { IAppConfig } from '../../src/config/app-config'
import { createMockAppConfig } from './mock-app-config'
import { createMockI18n } from './mock-i18n'
import { createMockLogger } from './mock-logger'

/**
 * Creates a test DI container with ILogger, I18N, and IAppConfig
 * pre-registered with default mocks. Additional registrations can be
 * passed in to override the defaults or add fixtures.
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

	// Pre-register a mock AppConfig (dev-shaped). Services constructed in
	// tests now resolve(IAppConfig) at construction time; without this
	// registration the container throws on resolution.
	container.register(Registration.instance(IAppConfig, createMockAppConfig()))

	// Register any additional dependencies
	for (const registration of registrations) {
		container.register(registration)
	}

	return container
}
