import { I18nConfiguration } from '@aurelia/i18n'
import { tasksSettled } from '@aurelia/runtime'
import { createFixture } from '@aurelia/testing'
import { CustomElement } from 'aurelia'
import { afterEach, describe, expect, it } from 'vitest'
import ja from '../../locales/ja/translation.json'
import { ConfirmDialog } from './confirm-dialog'

const mounted: { stop: (dispose?: boolean) => unknown }[] = []

async function render(tone: 'default' | 'danger' = 'default') {
	const fixture = await createFixture
		.html(
			`<confirm-dialog heading="サインアウトしますか？" body="次に使うときは、パスキーでもう一度ログインします。" confirm-label="サインアウト" tone="${tone}" test-id="sign-out-confirm"></confirm-dialog>`,
		)
		.deps(
			I18nConfiguration.customize((options) => {
				options.initOptions = {
					lng: 'ja',
					resources: { ja: { translation: ja } },
					fallbackLng: 'ja',
				}
			}),
			ConfirmDialog,
		)
		.build().started
	mounted.push(fixture)
	const host = fixture.appHost
	const vm = CustomElement.for<ConfirmDialog>(
		host.querySelector('confirm-dialog') as HTMLElement,
	).viewModel
	const q = <T extends Element>(testId: string) =>
		host.querySelector<T>(`[data-testid="${testId}"]`) as T
	return {
		vm,
		dialog: q<HTMLDialogElement>('sign-out-confirm'),
		cancel: q<HTMLButtonElement>('sign-out-confirm-cancel'),
		confirm: q<HTMLButtonElement>('sign-out-confirm-confirm'),
	}
}

describe('confirm-dialog', () => {
	afterEach(async () => {
		for (const f of mounted.splice(0)) await f.stop(true)
	})

	it('names the dialog by its heading and describes it by its body', async () => {
		const { dialog } = await render()
		const heading = dialog.querySelector(
			`#${dialog.getAttribute('aria-labelledby')}`,
		)
		const body = dialog.querySelector(
			`#${dialog.getAttribute('aria-describedby')}`,
		)
		expect(heading?.textContent).toBe('サインアウトしますか？')
		expect(body?.textContent).toBe(
			'次に使うときは、パスキーでもう一度ログインします。',
		)
	})

	it('opens with Cancel focused and resolves true on confirm', async () => {
		const { vm, dialog, cancel, confirm } = await render()
		const answer = vm.ask()
		expect(dialog.hasAttribute('open')).toBe(true)
		expect(document.activeElement).toBe(cancel)
		expect(cancel.textContent).toBe(ja.confirmDialog.cancel)

		confirm.click()
		await expect(answer).resolves.toBe(true)
		expect(dialog.hasAttribute('open')).toBe(false)
	})

	it('resolves false on Cancel', async () => {
		const { vm, dialog, cancel } = await render()
		const answer = vm.ask()
		cancel.click()
		await expect(answer).resolves.toBe(false)
		expect(dialog.hasAttribute('open')).toBe(false)
	})

	it('resolves false when the dialog closes on Escape', async () => {
		const { vm, dialog } = await render()
		const answer = vm.ask()
		// A browser turns Escape into a `close` of the modal dialog.
		dialog.removeAttribute('open')
		dialog.dispatchEvent(new Event('close'))
		await expect(answer).resolves.toBe(false)
	})

	it('resolves false on a tap on the backdrop, not on one inside the dialog', async () => {
		const { vm, dialog } = await render()
		const answer = vm.ask()
		dialog.querySelector('h2')?.click()
		dialog.click()
		await expect(answer).resolves.toBe(false)
	})

	it('keeps Escape and Tab from reaching a sheet that listens on the document', async () => {
		const { vm, dialog } = await render()
		void vm.ask()
		const reached: string[] = []
		const listener = (e: KeyboardEvent) => reached.push(e.key)
		document.addEventListener('keydown', listener)
		for (const key of ['Escape', 'Tab', 'Enter']) {
			dialog.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
		}
		document.removeEventListener('keydown', listener)
		expect(reached).toEqual(['Enter'])
	})

	it('answers an earlier ask with false when asked again, and on detach', async () => {
		const { vm } = await render()
		const first = vm.ask()
		const second = vm.ask()
		await expect(first).resolves.toBe(false)
		vm.detaching()
		await expect(second).resolves.toBe(false)
	})

	it('colours the confirm control as danger only for the danger tone', async () => {
		const plain = await render()
		expect(plain.confirm.hasAttribute('data-variant')).toBe(false)
		const danger = await render('danger')
		await tasksSettled()
		expect(danger.confirm.getAttribute('data-variant')).toBe('danger')
	})
})
