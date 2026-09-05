import { describe, expect, it } from 'vitest'

import { resolveRuntimeConfig } from './runtime'

describe('resolveRuntimeConfig', () => {
	const production = {
		NEXT_PUBLIC_MODE: 'production',
		NEXT_PUBLIC_APP_URL: 'https://crm.winwidget.ru',
		NEXT_PUBLIC_MAIN_APP_URL: 'https://winwidget.ru',
		NEXT_PUBLIC_API_URL: 'https://api.winwidget.ru/api/v1'
	}
	it.each([undefined, 'false'])(
		'keeps the application closed in production unless explicitly released',
		flag => {
			expect(
				resolveRuntimeConfig({
					...production,
					NEXT_PUBLIC_WINCRM_ENABLED: flag
				}).wincrmEnabled
			).toBe(false)
		}
	)
	it('keeps development working and allows a local prelaunch preview', () => {
		expect(resolveRuntimeConfig({ NODE_ENV: 'test' }).wincrmEnabled).toBe(
			true
		)
		expect(
			resolveRuntimeConfig({
				NODE_ENV: 'test',
				NEXT_PUBLIC_WINCRM_ENABLED: 'false'
			}).wincrmEnabled
		).toBe(false)
	})
	it('keeps application and billing release flags independent', () => {
		const applicationOnly = resolveRuntimeConfig({
			...production,
			NEXT_PUBLIC_WINCRM_ENABLED: 'true'
		})
		expect(applicationOnly.wincrmEnabled).toBe(true)
		expect(applicationOnly.wincrmBillingEnabled).toBe(false)
		const billingOnly = resolveRuntimeConfig({
			...production,
			NEXT_PUBLIC_WINCRM_BILLING_ENABLED: 'true'
		})
		expect(billingOnly.wincrmEnabled).toBe(false)
		expect(billingOnly.wincrmBillingEnabled).toBe(true)
	})
	it.each(['', '1', '0', 'TRUE', 'False', 'yes', ' true ', 'false\n'])(
		'rejects ambiguous application release flag values',
		flag => {
			expect(() =>
				resolveRuntimeConfig({ NEXT_PUBLIC_WINCRM_ENABLED: flag })
			).toThrow('NEXT_PUBLIC_WINCRM_ENABLED must be true or false')
		}
	)
	it.each([undefined, 'false'])(
		'keeps paid billing off by default and on explicit false',
		flag => {
			expect(
				resolveRuntimeConfig({
					NODE_ENV: 'test',
					NEXT_PUBLIC_WINCRM_BILLING_ENABLED: flag
				}).wincrmBillingEnabled
			).toBe(false)
		}
	)
	it('requires explicit true to enable the paid billing UI', () => {
		expect(
			resolveRuntimeConfig({
				NODE_ENV: 'test',
				NEXT_PUBLIC_WINCRM_BILLING_ENABLED: 'true'
			}).wincrmBillingEnabled
		).toBe(true)
	})
	it.each(['', '1', '0', 'TRUE', 'False', 'yes', ' true ', 'false\n'])(
		'rejects ambiguous paid billing flag values',
		flag => {
			expect(() =>
				resolveRuntimeConfig({
					NODE_ENV: 'test',
					NEXT_PUBLIC_WINCRM_BILLING_ENABLED: flag
				})
			).toThrow('NEXT_PUBLIC_WINCRM_BILLING_ENABLED must be true or false')
		}
	)
	it('uses safe local defaults outside production', () => {
		expect(resolveRuntimeConfig({ NODE_ENV: 'test' })).toEqual({
			mode: 'development',
			appOrigin: 'http://localhost:3001',
			mainAppOrigin: 'http://localhost:3000',
			apiBaseUrl: 'http://localhost:4100/api/v1',
			wincrmEnabled: true,
			wincrmBillingEnabled: false
		})
	})

	it('accepts only canonical production URLs', () => {
		expect(
			resolveRuntimeConfig({
				NEXT_PUBLIC_MODE: 'production',
				NEXT_PUBLIC_APP_URL: 'https://crm.winwidget.ru',
				NEXT_PUBLIC_MAIN_APP_URL: 'https://winwidget.ru',
				NEXT_PUBLIC_API_URL: 'https://api.winwidget.ru/api/v1'
			})
		).toEqual({
			mode: 'production',
			appOrigin: 'https://crm.winwidget.ru',
			mainAppOrigin: 'https://winwidget.ru',
			apiBaseUrl: 'https://api.winwidget.ru/api/v1',
			wincrmEnabled: false,
			wincrmBillingEnabled: false
		})
	})

	it.each([
		{
			NEXT_PUBLIC_APP_URL: 'https://crm.winwidget.ru.evil.example',
			NEXT_PUBLIC_MAIN_APP_URL: 'https://winwidget.ru',
			NEXT_PUBLIC_API_URL: 'https://api.winwidget.ru/api/v1'
		},
		{
			NEXT_PUBLIC_APP_URL: 'https://crm.winwidget.ru',
			NEXT_PUBLIC_MAIN_APP_URL: 'https://winwidget.ru:444',
			NEXT_PUBLIC_API_URL: 'https://api.winwidget.ru/api/v1'
		},
		{
			NEXT_PUBLIC_APP_URL: 'https://crm.winwidget.ru',
			NEXT_PUBLIC_MAIN_APP_URL: 'https://winwidget.ru',
			NEXT_PUBLIC_API_URL: 'http://api.winwidget.ru/api/v1'
		}
	])('rejects non-canonical production URLs', values => {
		expect(() =>
			resolveRuntimeConfig({
				NEXT_PUBLIC_MODE: 'production',
				...values
			})
		).toThrow('Production public URLs do not match canonical origins')
	})

	it('rejects credentials and unexpected API paths', () => {
		expect(() =>
			resolveRuntimeConfig({
				NEXT_PUBLIC_APP_URL: 'http://user:password@localhost:3001'
			})
		).toThrow('NEXT_PUBLIC_APP_URL must be a safe HTTP URL')

		expect(() =>
			resolveRuntimeConfig({
				NEXT_PUBLIC_API_URL: 'http://localhost:4100/internal'
			})
		).toThrow('NEXT_PUBLIC_API_URL must use the /api/v1 prefix')
	})
})
