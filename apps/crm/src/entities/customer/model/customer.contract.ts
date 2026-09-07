import {
	hasExactKeys,
	isIsoDate,
	isNonEmptyString,
	isRecord,
	isUuidV4
} from '@/shared/lib/contract'

export type CustomerKind = 'contacts' | 'companies'
export interface CustomerBase {
	id: string
	workspaceId: string
	name: string
	notes: string | null
	createdBySubject: string
	teamId: string | null
	version: number
	archivedAt: string | null
	createdAt: string
	updatedAt: string
}
export interface ContactFields {
	phone: string | null
	email: string | null
	companyId: string | null
}
export interface CompanyFields {
	inn: string | null
	website: string | null
}
export interface CompanyRequisites {
	legalName: string | null
	kpp: string | null
	ogrn: string | null
	legalAddress: string | null
	entityType: 'LEGAL' | 'INDIVIDUAL' | null
}
export type Customer =
	| (CustomerBase & ContactFields & { kind: 'contacts' })
	| (CustomerBase &
			CompanyFields &
			Partial<CompanyRequisites> & { kind: 'companies' })
export interface CustomerPage {
	schemaVersion: 1 | 2
	page: number
	pageSize: number
	total: number
	items: Customer[]
}
export type CustomerFields = Pick<
	CustomerBase,
	'name' | 'notes' | 'teamId'
> &
	(ContactFields | (CompanyFields & Partial<CompanyRequisites>))

const nullableText = (value: unknown, length: number) =>
	value === null || (typeof value === 'string' && value.length <= length)
const nullableUuid = (value: unknown) => value === null || isUuidV4(value)
const baseKeys = [
	'id',
	'workspaceId',
	'name',
	'notes',
	'createdBySubject',
	'teamId',
	'version',
	'archivedAt',
	'createdAt',
	'updatedAt'
]

export const parseCustomer = (
	value: unknown,
	kind: CustomerKind,
	workspaceId: string
): Customer | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			...baseKeys,
			...(kind === 'contacts'
				? ['phone', 'email', 'companyId']
				: ['inn', 'website'])
		]) ||
		!isUuidV4(value.id) ||
		!isUuidV4(value.workspaceId) ||
		value.workspaceId !== workspaceId ||
		!isNonEmptyString(value.name, 200) ||
		!nullableText(value.notes, 5000) ||
		!isNonEmptyString(value.createdBySubject, 256) ||
		!nullableUuid(value.teamId) ||
		!Number.isSafeInteger(value.version) ||
		Number(value.version) < 1 ||
		Number(value.version) > 2147483647 ||
		!(value.archivedAt === null || isIsoDate(value.archivedAt)) ||
		!isIsoDate(value.createdAt) ||
		!isIsoDate(value.updatedAt)
	)
		return null
	if (kind === 'contacts') {
		if (
			!(
				value.phone === null ||
				(typeof value.phone === 'string' &&
					/^\+[1-9][0-9]{6,14}$/.test(value.phone))
			) ||
			!nullableText(value.email, 254) ||
			!nullableUuid(value.companyId)
		)
			return null
	} else {
		if (
			!(
				value.inn === null ||
				(typeof value.inn === 'string' &&
					/^(?:[0-9]{10}|[0-9]{12})$/.test(value.inn))
			) ||
			!nullableText(value.website, 2048)
		)
			return null
		if (value.website !== null) {
			try {
				const url = new URL(String(value.website))
				if (
					!['http:', 'https:'].includes(url.protocol) ||
					url.username ||
					url.password
				)
					return null
			} catch {
				return null
			}
		}
	}
	return { ...value, kind } as unknown as Customer
}

export const parseCustomerResult = (
	value: unknown,
	kind: CustomerKind,
	workspaceId: string,
	expectedId?: string,
	schemaVersion: 1 | 2 = 1
) => {
	const key = kind === 'contacts' ? 'contact' : 'company'
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ['schemaVersion', key]) ||
		value.schemaVersion !== schemaVersion ||
		(schemaVersion === 2 && kind !== 'companies')
	)
		return null
	const result =
		schemaVersion === 2
			? parseCompanyV2(value[key], workspaceId)
			: parseCustomer(value[key], kind, workspaceId)
	return result && (!expectedId || result.id === expectedId)
		? result
		: null
}

export const parseCustomerPage = (
	value: unknown,
	kind: CustomerKind,
	workspaceId: string,
	page: number,
	pageSize: number,
	schemaVersion: 1 | 2 = 1
): CustomerPage | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			'schemaVersion',
			'items',
			'page',
			'pageSize',
			'total'
		]) ||
		value.schemaVersion !== schemaVersion ||
		(schemaVersion === 2 && kind !== 'companies') ||
		value.page !== page ||
		value.pageSize !== pageSize ||
		!Number.isSafeInteger(value.total) ||
		Number(value.total) < 0 ||
		!Array.isArray(value.items) ||
		value.items.length > pageSize ||
		value.items.length > Number(value.total)
	)
		return null
	const items = value.items.map(item =>
		schemaVersion === 2
			? parseCompanyV2(item, workspaceId)
			: parseCustomer(item, kind, workspaceId)
	)
	if (
		items.some(item => !item || item.archivedAt !== null) ||
		new Set(items.map(item => item?.id)).size !== items.length
	)
		return null
	return {
		schemaVersion,
		page,
		pageSize,
		total: Number(value.total),
		items: items as Customer[]
	}
}

/** v1 stays exact for published exports and legacy command receipts. */
export const parseCompanyV2 = (
	value: unknown,
	workspaceId: string
): Customer | null => {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			...baseKeys,
			'inn',
			'website',
			'legalName',
			'kpp',
			'ogrn',
			'legalAddress',
			'entityType'
		])
	)
		return null
	const { legalName, kpp, ogrn, legalAddress, entityType, ...legacy } =
		value
	if (
		!nullableText(legalName, 2000) ||
		!nullableText(legalAddress, 2000) ||
		!(kpp === null || (typeof kpp === 'string' && /^\d{9}$/.test(kpp))) ||
		!(
			ogrn === null ||
			(typeof ogrn === 'string' && /^(?:\d{13}|\d{15})$/.test(ogrn))
		) ||
		!(
			entityType === null ||
			entityType === 'LEGAL' ||
			entityType === 'INDIVIDUAL'
		)
	)
		return null
	const parsed = parseCustomer(legacy, 'companies', workspaceId)
	return parsed
		? ({
				...parsed,
				legalName,
				kpp,
				ogrn,
				legalAddress,
				entityType
			} as Customer)
		: null
}
