import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	getCustomer,
	listCustomers,
	mutateCustomer,
	lookupCompany,
	type Customer
} from '@/entities/customer'
import { useSessionStore } from '@/entities/session'
import { getCrmPermissions } from '@/entities/crm-access'
import {
	PendingCommandProvider,
	commandOwner
} from '@/shared/lib/pending-command'
import { AuthenticatedApiError } from '@/shared/api/authenticated-http-client'
import { CustomerEditor } from './CustomerEditor'

vi.mock('@/entities/customer', async importOriginal => ({
	...(await importOriginal<typeof import('@/entities/customer')>()),
	getCustomer: vi.fn(),
	listCustomers: vi.fn(),
	mutateCustomer: vi.fn(),
	findCustomerDuplicates: vi.fn(),
	lookupCompany: vi.fn()
}))
vi.mock('@/entities/crm-access', async importOriginal => ({
	...(await importOriginal<typeof import('@/entities/crm-access')>()),
	getCrmPermissions: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
	default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
const workspaceId = '11111111-1111-4111-8111-111111111111'
const contact: Customer = {
	kind: 'contacts',
	id: '22222222-2222-4222-8222-222222222222',
	workspaceId,
	name: 'Клиент QA',
	notes: null,
	createdBySubject: 'user-1',
	teamId: null,
	version: 3,
	archivedAt: null,
	createdAt: '2026-09-05T00:00:00.000Z',
	updatedAt: '2026-09-05T00:00:00.000Z',
	phone: null,
	email: null,
	companyId: null
}
let client: QueryClient
beforeEach(() => {
	vi.clearAllMocks()
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
	client = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false }
		}
	})
	useSessionStore.setState({
		session: { accessToken: 'token', userId: 'user-1' },
		status: 'authenticated',
		sessionRevision: 1
	})
	vi.mocked(listCustomers).mockResolvedValue({
		schemaVersion: 1,
		items: [],
		page: 1,
		pageSize: 25,
		total: 0
	})
	vi.mocked(getCustomer).mockResolvedValue(contact)
	vi.mocked(mutateCustomer).mockResolvedValue(contact)
	vi.mocked(getCrmPermissions).mockResolvedValue({
		workspaceId,
		subject: 'user-1',
		state: 'ACTIVE',
		permissions: ['customers:write']
	} as never)
})

describe('CompanyEditor explicit requisites workflow', () => {
	const company: Customer = {
		kind: 'companies',
		id: contact.id,
		workspaceId,
		name: 'Моя компания',
		notes: 'Мои заметки',
		createdBySubject: 'user-1',
		teamId: null,
		version: 3,
		archivedAt: null,
		createdAt: contact.createdAt,
		updatedAt: contact.updatedAt,
		inn: '7707083893',
		website: 'https://example.test',
		legalName: null,
		kpp: '123456789',
		ogrn: null,
		legalAddress: null,
		entityType: null
	}
	const item = {
		name: 'Название из справочника',
		legalName: 'Полное название из справочника',
		inn: '7707083893',
		kpp: '770701001',
		ogrn: '1027700132195',
		legalAddress: 'Москва, адрес',
		entityType: 'LEGAL' as const,
		status: 'ACTIVE' as const
	}
	const mountCompany = (canWrite = true, id?: string) => {
		vi.mocked(getCustomer).mockResolvedValue(company)
		vi.mocked(mutateCustomer).mockResolvedValue(company)
		vi.mocked(lookupCompany).mockResolvedValue({
			schemaVersion: 1,
			provider: 'DADATA',
			queriedAt: contact.updatedAt,
			inn: item.inn,
			items: [item]
		})
		const onSaved = vi.fn(),
			onClose = vi.fn()
		render(
			<QueryClientProvider client={client}>
				<PendingCommandProvider owner={commandOwner('user-1', 1)}>
					<CustomerEditor
						workspaceId={workspaceId}
						kind="companies"
						id={id}
						canWrite={canWrite}
						onSaved={onSaved}
						onClose={onClose}
					/>
				</PendingCommandProvider>
			</QueryClientProvider>
		)
		return { onSaved, onClose }
	}
	const findAndApply = async (overwrite = false) => {
		fireEvent.click(
			await screen.findByRole('button', { name: 'Найти реквизиты' })
		)
		await screen.findByText(item.name)
		if (overwrite)
			fireEvent.click(
				screen.getByRole('checkbox', {
					name: /Заменить уже заполненные реквизиты/
				})
			)
		fireEvent.click(
			screen.getByRole('button', { name: 'Заполнить форму' })
		)
		await waitFor(() =>
			expect(
				screen.getByRole('textbox', { name: 'Полное наименование' })
			).toHaveProperty('value', item.legalName)
		)
	}
	it('fills only empty requisites and never autosaves or overwrites name, KPP, notes and website', async () => {
		const callbacks = mountCompany(true, company.id)
		await findAndApply()
		expect(
			screen.getByRole('textbox', { name: 'Название компании' })
		).toHaveProperty('value', company.name)
		expect(screen.getByRole('textbox', { name: 'КПП' })).toHaveProperty(
			'value',
			company.kpp
		)
		expect(screen.getByRole('textbox', { name: 'Сайт' })).toHaveProperty(
			'value',
			company.website
		)
		expect(
			screen.getByRole('textbox', { name: 'Заметки' })
		).toHaveProperty('value', company.notes)
		expect(
			screen.getByRole('combobox', { name: 'Тип организации' })
		).toHaveProperty('value', 'LEGAL')
		expect(mutateCustomer).not.toHaveBeenCalled()
		expect(callbacks.onClose).not.toHaveBeenCalled()
		fireEvent.submit(document.getElementById('customer-editor')!)
		await waitFor(() => expect(mutateCustomer).toHaveBeenCalledTimes(1))
		expect(vi.mocked(mutateCustomer).mock.calls[0][1]).toMatchObject({
			schemaVersion: 2,
			kind: 'companies',
			id: company.id,
			expectedVersion: 3,
			fields: {
				name: company.name,
				kpp: company.kpp,
				legalName: item.legalName,
				legalAddress: item.legalAddress,
				ogrn: item.ogrn,
				entityType: 'LEGAL',
				notes: company.notes,
				website: company.website
			}
		})
	})
	it('replaces populated requisites only after an explicit checkbox, not unrelated fields', async () => {
		mountCompany(true, company.id)
		await findAndApply(true)
		expect(
			screen.getByRole('textbox', { name: 'Название компании' })
		).toHaveProperty('value', item.name)
		expect(screen.getByRole('textbox', { name: 'КПП' })).toHaveProperty(
			'value',
			item.kpp
		)
		expect(
			screen.getByRole('textbox', { name: 'Заметки' })
		).toHaveProperty('value', company.notes)
		expect(mutateCustomer).not.toHaveBeenCalled()
	})
	it('preserves manual INN length-only validation independently of the optional lookup checksum', async () => {
		mountCompany()
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Название компании' }),
			{ target: { value: 'Вручную' } }
		)
		fireEvent.change(screen.getByRole('textbox', { name: 'ИНН' }), {
			target: { value: '1234567890' }
		})
		fireEvent.submit(document.getElementById('customer-editor')!)
		await waitFor(() => expect(mutateCustomer).toHaveBeenCalledTimes(1))
		expect(vi.mocked(mutateCustomer).mock.calls[0][1]).toMatchObject({
			schemaVersion: 2,
			fields: {
				inn: '1234567890',
				legalName: null,
				kpp: null,
				ogrn: null,
				legalAddress: null,
				entityType: null
			}
		})
		expect(lookupCompany).not.toHaveBeenCalled()
	})
	it('keeps manual editing and explicit save usable after a provider outage', async () => {
		mountCompany(true, company.id)
		vi.mocked(lookupCompany).mockRejectedValue(
			new AuthenticatedApiError('temporary', 'Поиск недоступен')
		)
		fireEvent.click(
			await screen.findByRole('button', { name: 'Найти реквизиты' })
		)
		await screen.findByRole('alert')
		fireEvent.change(
			screen.getByRole('textbox', { name: 'Полное наименование' }),
			{ target: { value: 'Введено вручную' } }
		)
		fireEvent.submit(document.getElementById('customer-editor')!)
		await waitFor(() => expect(mutateCustomer).toHaveBeenCalledTimes(1))
		expect(vi.mocked(mutateCustomer).mock.calls[0][1]).toMatchObject({
			schemaVersion: 2,
			fields: { legalName: 'Введено вручную' }
		})
	})
	it('freezes an uncertain company v2 command, with no lookup action, and replays its exact requisites', async () => {
		mountCompany(true, company.id)
		vi.mocked(mutateCustomer)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Ответ потерян')
			)
			.mockResolvedValueOnce(company)
		fireEvent.change(
			await screen.findByRole('textbox', { name: 'Полное наименование' }),
			{ target: { value: 'Зафиксированный черновик' } }
		)
		fireEvent.submit(document.getElementById('customer-editor')!)
		await screen.findByRole('button', { name: 'Повторить запрос' })
		expect(
			screen.queryByRole('button', { name: 'Найти реквизиты' })
		).toBeNull()
		expect(
			screen.getByRole('textbox', { name: 'Полное наименование' })
		).toHaveProperty('readOnly', true)
		const original = vi.mocked(mutateCustomer).mock.calls[0][1]
		expect(original.schemaVersion).toBe(2)
		fireEvent.submit(document.getElementById('customer-editor')!)
		await waitFor(() => expect(mutateCustomer).toHaveBeenCalledTimes(2))
		expect(vi.mocked(mutateCustomer).mock.calls[1][1]).toEqual(original)
		expect(lookupCompany).not.toHaveBeenCalled()
	})
	it('keeps v2 requisites readable, with no lookup/save or archive actions in READ_ONLY', async () => {
		mountCompany(false, company.id)
		expect(
			await screen.findByRole('textbox', { name: 'КПП' })
		).toHaveProperty('value', company.kpp)
		for (const label of [
			'КПП',
			'Полное наименование',
			'Юридический адрес'
		])
			expect(screen.getByRole('textbox', { name: label })).toHaveProperty(
				'readOnly',
				true
			)
		expect(
			screen.queryByRole('button', { name: 'Найти реквизиты' })
		).toBeNull()
		expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull()
		expect(lookupCompany).not.toHaveBeenCalled()
	})
	it('archives existing companies using an explicit v2 command with CAS', async () => {
		mountCompany(true, company.id)
		fireEvent.click(
			await screen.findByRole('button', { name: 'Архивировать запись' })
		)
		fireEvent.click(
			screen.getByRole('button', { name: 'Подтвердить архивирование' })
		)
		await waitFor(() => expect(mutateCustomer).toHaveBeenCalledTimes(1))
		expect(vi.mocked(mutateCustomer).mock.calls[0][1]).toMatchObject({
			schemaVersion: 2,
			archive: true,
			id: company.id,
			expectedVersion: 3
		})
	})
})
afterEach(() => {
	cleanup()
	client.clear()
})
const mount = (canWrite = true, id?: string) => {
	const onSaved = vi.fn()
	const onClose = vi.fn()
	render(
		<QueryClientProvider client={client}>
			<PendingCommandProvider owner={commandOwner('user-1', 1)}>
				<CustomerEditor
					workspaceId={workspaceId}
					kind="contacts"
					id={id}
					canWrite={canWrite}
					onSaved={onSaved}
					onClose={onClose}
				/>
			</PendingCommandProvider>
		</QueryClientProvider>
	)
	return { onSaved, onClose }
}
describe('CustomerEditor', () => {
	it('keeps the company-picker workspace prefix invalidatable while isolating its v2 cache', async () => {
		mount()
		await waitFor(() => expect(listCustomers).toHaveBeenCalled())
		const keys = client
			.getQueryCache()
			.findAll({ queryKey: ['crm-company-picker', workspaceId] })
			.map(query => query.queryKey)
		expect(keys).toHaveLength(1)
		expect(keys[0].slice(0, 3)).toEqual([
			'crm-company-picker',
			workspaceId,
			2
		])
	})
	it('loads real records and keeps read-only fields viewable without mutation controls', async () => {
		mount(false, contact.id)
		expect(
			await screen.findByRole('textbox', { name: 'Имя' })
		).toHaveProperty('readOnly', true)
		expect(screen.getByRole('textbox', { name: 'Имя' })).toHaveProperty(
			'value',
			'Клиент QA'
		)
		expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull()
		expect(mutateCustomer).not.toHaveBeenCalled()
	})
	it('sends the current record version and closes only after confirmed success', async () => {
		const callbacks = mount(true, contact.id)
		fireEvent.change(await screen.findByRole('textbox', { name: 'Имя' }), {
			target: { value: 'Изменённое имя' }
		})
		fireEvent.submit(document.getElementById('customer-editor')!)
		await waitFor(() => expect(mutateCustomer).toHaveBeenCalledTimes(1))
		expect(vi.mocked(mutateCustomer).mock.calls[0][1]).toMatchObject({
			workspaceId,
			id: contact.id,
			expectedVersion: 3,
			fields: {
				name: 'Изменённое имя',
				phone: null,
				email: null,
				teamId: null
			}
		})
		await waitFor(() => expect(callbacks.onClose).toHaveBeenCalledTimes(1))
	})
	it('freezes an uncertain command and retries its exact id and payload', async () => {
		vi.mocked(mutateCustomer)
			.mockRejectedValueOnce(
				new AuthenticatedApiError('temporary', 'Сеть недоступна')
			)
			.mockResolvedValueOnce(contact)
		mount()
		fireEvent.change(screen.getByRole('textbox', { name: 'Имя' }), {
			target: { value: 'Новый клиент' }
		})
		fireEvent.submit(document.getElementById('customer-editor')!)
		await screen.findByRole('button', { name: 'Повторить запрос' })
		expect(screen.getByRole('textbox', { name: 'Имя' })).toHaveProperty(
			'readOnly',
			true
		)
		fireEvent.submit(document.getElementById('customer-editor')!)
		await waitFor(() => expect(mutateCustomer).toHaveBeenCalledTimes(2))
		expect(vi.mocked(mutateCustomer).mock.calls[1][1]).toEqual(
			vi.mocked(mutateCustomer).mock.calls[0][1]
		)
	})
	it('requires an explicit confirmation before archive', async () => {
		mount(true, contact.id)
		fireEvent.click(
			await screen.findByRole('button', { name: 'Архивировать запись' })
		)
		expect(mutateCustomer).not.toHaveBeenCalled()
		fireEvent.click(
			screen.getByRole('button', { name: 'Подтвердить архивирование' })
		)
		await waitFor(() => expect(mutateCustomer).toHaveBeenCalledTimes(1))
		expect(vi.mocked(mutateCustomer).mock.calls[0][1]).toMatchObject({
			archive: true,
			id: contact.id,
			expectedVersion: 3
		})
	})
	it('does not silently overwrite a concurrent edit', async () => {
		vi.mocked(mutateCustomer).mockRejectedValue(
			new AuthenticatedApiError('conflict', 'Версия изменилась')
		)
		mount(true, contact.id)
		await screen.findByRole('textbox', { name: 'Имя' })
		fireEvent.submit(document.getElementById('customer-editor')!)
		await screen.findByRole('button', {
			name: 'Загрузить актуальную версию'
		})
		expect(
			screen.getByRole('button', { name: 'Сохранить' })
		).toHaveProperty('disabled', true)
		expect(mutateCustomer).toHaveBeenCalledTimes(1)
	})
})
