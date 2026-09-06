import {
	cleanup,
	fireEvent,
	render,
	screen,
	within
} from '@testing-library/react'
import type { ComponentProps } from 'react'
import toast from 'react-hot-toast'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CrmAppShell from './CrmAppShell'
import { getRuntimeConfig } from '@/shared/config/runtime'

const fixture = vi.hoisted(() => ({
	pathname: '/inbox',
	access: {
		state: 'ACTIVE' as 'ACTIVE' | 'GRACE' | 'READ_ONLY',
		isReadOnly: false,
		membership: { role: 'OWNER' as 'OWNER' | 'MEMBER' },
		entitlement: {
			graceUntil: '2026-09-12T12:00:00.000Z' as string | null
		}
	}
}))
vi.mock('next/navigation', () => ({ usePathname: () => fixture.pathname }))
vi.mock('@/entities/crm-access', () => ({
	useCrmWorkspaceAccess: () => fixture.access
}))
vi.mock('react-hot-toast', () => ({ default: vi.fn() }))
vi.mock('next/link', () => ({
	default: ({ children, onClick, ...props }: ComponentProps<'a'>) => (
		<a
			{...props}
			onClick={event => {
				onClick?.(event)
				event.preventDefault()
			}}
		>
			{children}
		</a>
	)
}))

beforeEach(() => {
	fixture.pathname = '/inbox'
	fixture.access.state = 'ACTIVE'
	fixture.access.isReadOnly = false
	fixture.access.membership.role = 'OWNER'
	fixture.access.entitlement.graceUntil = '2026-09-12T12:00:00.000Z'
	Object.defineProperties(HTMLDialogElement.prototype, {
		showModal: {
			configurable: true,
			value: function (this: HTMLDialogElement) {
				this.open = true
			}
		},
		close: {
			configurable: true,
			value: function (this: HTMLDialogElement) {
				this.open = false
			}
		}
	})
})
afterEach(() => {
	cleanup()
	Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
	Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
})
const mount = () =>
	render(
		<CrmAppShell>
			<h1>Содержимое раздела</h1>
		</CrmAppShell>
	)
const mainNavigation = () =>
	screen.getByRole('navigation', { name: 'Основная навигация CRM' })

describe('honest WinCRM application shell', () => {
	it('shows current access and membership without demo copy, fake search or paid claims', () => {
		mount()
		expect(screen.getByText('Доступ активен')).toBeTruthy()
		expect(screen.getByText('Владелец пространства')).toBeTruthy()
		expect(screen.queryByRole('search')).toBeNull()
		expect(screen.queryByRole('searchbox')).toBeNull()
		expect(document.body.textContent).not.toMatch(
			/демо|прототип|Оплачено/i
		)
		expect(
			screen
				.getByRole('link', { name: 'Перейти к содержимому' })
				.getAttribute('href')
		).toBe('#crm-main-content')
		expect(screen.getByRole('main').getAttribute('id')).toBe(
			'crm-main-content'
		)
	})
	it('does not invent a CRM role for workspace members', () => {
		fixture.access.membership.role = 'MEMBER'
		mount()
		expect(screen.getByText('Участник пространства')).toBeTruthy()
		expect(document.body.textContent).not.toMatch(
			/CRM_ADMIN|Менеджер|Администратор/
		)
	})
	it('preserves GRACE status, allowance and backend deadline', () => {
		fixture.access.state = 'GRACE'
		mount()
		expect(screen.getByText('Льготный период')).toBeTruthy()
		expect(screen.getByText('Дополнительные 3 дня доступа')).toBeTruthy()
		expect(document.querySelector('time')?.getAttribute('datetime')).toBe(
			fixture.access.entitlement.graceUntil
		)
		expect(screen.queryByText('Доступ активен')).toBeNull()
	})
	it('preserves READ_ONLY explanation and visible section contents', () => {
		fixture.access.state = 'READ_ONLY'
		fixture.access.isReadOnly = true
		mount()
		expect(screen.getByText('Только чтение')).toBeTruthy()
		expect(
			screen.getByText('WinCRM доступна только для чтения')
		).toBeTruthy()
		expect(
			screen.getByRole('heading', { name: 'Содержимое раздела' })
		).toBeTruthy()
	})
	it('resolves nested sections and preserves active navigation', () => {
		fixture.pathname = '/contacts/companies'
		mount()
		expect(
			within(mainNavigation())
				.getByRole('link', { name: 'Контакты' })
				.getAttribute('aria-current')
		).toBe('page')
		expect(
			document.querySelector('[aria-label="Текущий раздел"]')?.textContent
		).toBe('WinCRMКонтакты')
	})
	it('uses a neutral context for unknown paths, never a fabricated workspace name', () => {
		fixture.pathname = '/unknown'
		mount()
		expect(
			document.querySelector('[aria-label="Текущий раздел"]')?.textContent
		).toBe('WinCRMРабочее пространство')
	})
	it('toasts ordinary navigation once, but not active or modified clicks', () => {
		mount()
		fireEvent.click(
			within(mainNavigation()).getByRole('link', { name: 'Входящие' })
		)
		fireEvent.click(
			within(mainNavigation()).getByRole('link', { name: 'Задачи' }),
			{ ctrlKey: true }
		)
		expect(toast).not.toHaveBeenCalled()
		fireEvent.click(
			within(mainNavigation()).getByRole('link', { name: 'Задачи' })
		)
		expect(toast).toHaveBeenCalledExactlyOnceWith(
			'Переход в раздел «Задачи»',
			{ id: 'crm-navigation' }
		)
	})
	it('keeps accessible mobile navigation and closes the drawer on ordinary navigation', () => {
		mount()
		const toggle = screen.getByRole('button', {
			name: 'Открыть навигацию CRM'
		})
		fireEvent.click(toggle)
		expect(toggle.getAttribute('aria-expanded')).toBe('true')
		const navigation = screen.getByRole('navigation', {
			name: 'Мобильная навигация CRM'
		})
		fireEvent.click(
			within(navigation).getByRole('link', { name: 'Сделки' }),
			{ metaKey: true }
		)
		expect(toggle.getAttribute('aria-expanded')).toBe('true')
		fireEvent.click(
			within(navigation).getByRole('link', { name: 'Сделки' })
		)
		expect(toggle.getAttribute('aria-expanded')).toBe('false')
		expect(screen.queryByRole('dialog')).toBeNull()
		expect(toast).toHaveBeenCalledExactlyOnceWith(
			'Переход в раздел «Сделки»',
			{ id: 'crm-navigation' }
		)
	})
	it('offers both independent products even when CRM is read-only, without a forced chooser', () => {
		fixture.access.state = 'READ_ONLY'
		fixture.access.isReadOnly = true
		mount()
		const details = document.querySelector('details')!
		expect(details.open).toBe(false)
		expect(
			screen.getByRole('heading', { name: 'Содержимое раздела' })
		).toBeTruthy()
		details.open = true
		const products = screen.getByRole('navigation', {
			name: 'Рабочие приложения'
		})
		const widgets = within(products).getByRole('link', {
			name: 'WinWidget Виджеты и заявки'
		})
		const crm = within(products).getByRole('link', {
			name: 'WinCRM Клиенты и продажи'
		})
		expect(widgets.getAttribute('href')).toBe(
			new URL('/cabinet', getRuntimeConfig().mainAppOrigin).toString()
		)
		expect(widgets.getAttribute('aria-disabled')).toBeNull()
		expect(crm.getAttribute('href')).toBe('/inbox')
		expect(crm.getAttribute('aria-current')).toBe('true')
		expect(toast).not.toHaveBeenCalled()
	})
	it('keeps product links native and closes the product switch with Escape, blur and ordinary navigation', () => {
		mount()
		const details = document.querySelector('details')!
		const summary = details.querySelector('summary')!
		details.open = true
		const products = screen.getByRole('navigation', {
			name: 'Рабочие приложения'
		})
		const crm = within(products).getByRole('link', {
			name: 'WinCRM Клиенты и продажи'
		})
		fireEvent.click(crm, { ctrlKey: true })
		expect(details.open).toBe(true)
		expect(toast).not.toHaveBeenCalled()
		fireEvent.click(crm)
		expect(details.open).toBe(false)
		expect(toast).toHaveBeenCalledExactlyOnceWith('Переход в WinCRM', {
			id: 'product-navigation'
		})
		details.open = true
		crm.focus()
		fireEvent.keyDown(crm, { key: 'Escape' })
		expect(details.open).toBe(false)
		expect(document.activeElement).toBe(summary)
		details.open = true
		fireEvent.blur(summary, { relatedTarget: crm })
		expect(details.open).toBe(true)
		fireEvent.blur(crm, { relatedTarget: null })
		expect(details.open).toBe(false)
	})
})
