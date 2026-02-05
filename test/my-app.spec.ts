import { describe, it } from 'vitest';
import { MyApp } from '../src/my-app';
import { createFixture } from '@aurelia/testing';

describe('my-app', () => {

  it('should render with Shadow DOM and shared styles', async () => {
    const { appHost } = await createFixture(
      '<my-app></my-app>',
      {},
      [MyApp],
    ).started;

    // Get the my-app element from the host
    const element = appHost.querySelector('my-app');
    if (element === null) {
      throw new Error('Expected to find my-app element in host');
    }

    // Assert that the host element has a shadow root
    const shadowRoot = element.shadowRoot;
    if (shadowRoot === null) {
      throw new Error('Expected shadowRoot to be present, but it was null');
    }

    // Query inside the shadow root to verify the message text
    const messageElement = shadowRoot.querySelector('.message') || 
                          shadowRoot.querySelector('[class*="text-"]'); // Handle TailwindCSS classes
    if (messageElement === null) {
      throw new Error('Expected to find message element in shadow root');
    }

    // Verify the message contains 'Hello World!'
    const messageText = messageElement.textContent || '';
    if (!messageText.includes('Hello World!')) {
      throw new Error(`Expected message to contain 'Hello World!' but got: ${messageText}`);
    }

    // Verify presence of shared shadow DOM style elements (structure only, not computed styles)
    const sharedStyleElement = shadowRoot.querySelector('.shared-shadow-style');
    if (sharedStyleElement === null) {
      throw new Error('Expected to find .shared-shadow-style element in shadow root');
    }

    const sharedTextElement = shadowRoot.querySelector('.shared-shadow-text');
    if (sharedTextElement === null) {
      throw new Error('Expected to find .shared-shadow-text element in shadow root');
    }

    // Verify the shared text content
    const sharedTextContent = sharedTextElement.textContent || '';
    if (!sharedTextContent.includes('This content uses shared Shadow DOM styles!')) {
      throw new Error(`Expected shared text content but got: ${sharedTextContent}`);
    }
  });
});
