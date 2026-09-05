import { renderToStaticMarkup } from 'react-dom/server'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
	wincrmEnabled: false,
	providers: vi.fn(),
	redirect: vi.fn()
}))

vi.mock('@/shared/config/runtime', () => ({
	getRuntimeConfig: () => ({
		wincrmEnabled: fixture.wincrmEnabled,
		mainAppOrigin: 'https://winwidget.ru'
	})
}))
vi.mock('@/app/providers/AppProviders', () => ({
	default: ({ children }: PropsWithChildren) => {
		fixture.providers()
		return <>{children}</>
	}
}))
vi.mock('next/navigation', () => ({ redirect: fixture.redirect }))

import RootLayout from './layout'
import HomePage from './page'

beforeEach(() => {
	fixture.wincrmEnabled = false
	vi.clearAllMocks()
})

describe('server prelaunch boundary', () => {
	it('renders a complete honest page without providers, child sessions or API side effects', () => {
		const request = vi.fn()
		const Child = () => {
			request()
			return <p>Authenticated application</p>
		}
		const html = renderToStaticMarkup(
			<RootLayout>
				<Child />
			</RootLayout>
		)
		expect(html).toContain('WinCRM')
		expect(html).toContain('Скоро')
		expect(html).toContain('Перейти в WinWidget')
		expect(html).toContain('href="https://winwidget.ru"')
		expect(html).toContain('CRM и виджеты — отдельные продукты')
		expect(html).not.toContain('Authenticated application')
		expect(html).not.toContain('Не удалось проверить сессию')
		expect(html).not.toMatch(
			/Попробовать бесплатно|Оплатить|TRIAL|<form|<iframe/
		)
		expect(fixture.providers).not.toHaveBeenCalled()
		expect(request).not.toHaveBeenCalled()
	})

	it('does not redirect the prelaunch root to a session-protected route', () => {
		expect(HomePage()).toBeNull()
		expect(fixture.redirect).not.toHaveBeenCalled()
	})

	it('preserves the real application and root redirect when explicitly released', () => {
		fixture.wincrmEnabled = true
		const html = renderToStaticMarkup(
			<RootLayout>
				<p>Authenticated application</p>
			</RootLayout>
		)
		expect(html).toContain('Authenticated application')
		expect(html).not.toContain('Готовимся к запуску')
		expect(fixture.providers).toHaveBeenCalledOnce()
		HomePage()
		expect(fixture.redirect).toHaveBeenCalledExactlyOnceWith('/inbox')
	})
})
