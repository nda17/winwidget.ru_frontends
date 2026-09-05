import type { RuntimeConfig } from '@/shared/config/runtime'
import { describe, expect, it } from 'vitest'

import { buildLoginUrl } from './auth-return-url'

const config: RuntimeConfig = {
	mode: 'production',
	appOrigin: 'https://crm.winwidget.ru',
	mainAppOrigin: 'https://winwidget.ru',
	apiBaseUrl: 'https://api.winwidget.ru/api/v1',
	wincrmEnabled: true,
	wincrmBillingEnabled: false
}

describe('buildLoginUrl', () => {
	it('preserves the CRM path and query in an encoded returnUrl', () => {
		const value = buildLoginUrl(
			'https://crm.winwidget.ru/deals?stage=new&owner=me',
			config
		)
		const loginUrl = new URL(value)

		expect(loginUrl.origin).toBe('https://winwidget.ru')
		expect(loginUrl.pathname).toBe('/login')
		expect(loginUrl.searchParams.get('returnUrl')).toBe(
			'https://crm.winwidget.ru/deals?stage=new&owner=me'
		)
	})

	it('drops fragments from the return target', () => {
		const loginUrl = new URL(
			buildLoginUrl('https://crm.winwidget.ru/inbox#message-1', config)
		)

		expect(loginUrl.searchParams.get('returnUrl')).toBe(
			'https://crm.winwidget.ru/inbox'
		)
	})

	it.each([
		'https://crm.winwidget.ru.evil.example/inbox',
		'https://crm.winwidget.ru:444/inbox',
		'https://user@crm.winwidget.ru/inbox',
		'javascript:alert(1)',
		'/inbox'
	])('rejects unsafe return target %s', value => {
		expect(() => buildLoginUrl(value, config)).toThrow()
	})

	it('rejects an excessively long return target', () => {
		const prefix = 'https://crm.winwidget.ru/inbox?query='
		const maximumLengthUrl = `${prefix}${'x'.repeat(2048 - prefix.length)}`

		expect(() => buildLoginUrl(maximumLengthUrl, config)).not.toThrow()
		expect(() => buildLoginUrl(`${maximumLengthUrl}x`, config)).toThrow(
			'CRM return URL is invalid'
		)
	})
})
