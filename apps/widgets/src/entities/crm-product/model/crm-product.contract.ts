export interface CrmCommercialPolicy {
	schemaVersion: 1
	productCode: 'WINCRM'
	version: number
	currency: 'RUB'
	monthlyPriceMinor: number
	yearlyPriceMinor: number
	additionalSeatMonthlyPriceMinor: number
	additionalSeatYearlyPriceMinor: number
	includedSeats: number
	trialSeatLimit: number
	trialDays: 5
	graceDays: 3
	createdAt: string
}

export interface CrmProfileStatus {
	label: string
	tone: 'neutral' | 'active' | 'warning'
	expiresAt: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === 'object' && !Array.isArray(value)

const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
	Object.keys(value).length === keys.length &&
	keys.every(key => Object.prototype.hasOwnProperty.call(value, key))

const integer = (
	value: unknown,
	min: number,
	max = Number.MAX_SAFE_INTEGER
) =>
	typeof value === 'number' &&
	Number.isSafeInteger(value) &&
	value >= min &&
	value <= max

const isoDate = (value: unknown): value is string =>
	typeof value === 'string' &&
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
	Number.isFinite(Date.parse(value)) &&
	new Date(value).toISOString() === value

const uuid = (value: unknown): value is string =>
	typeof value === 'string' &&
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
		value
	)

const positiveDecimal = (value: unknown) =>
	typeof value === 'string' && /^[1-9]\d*$/.test(value)

const invalid = (): never => {
	throw new Error('Invalid WinCRM product response')
}

const PRICE_FIELDS = [
	'monthlyPriceMinor',
	'yearlyPriceMinor',
	'additionalSeatMonthlyPriceMinor',
	'additionalSeatYearlyPriceMinor'
] as const

/** Billing-owned public policy, never a Widgets tariff or client fallback. */
export function parseCrmCommercialPolicy(
	value: unknown
): CrmCommercialPolicy {
	if (
		!isRecord(value) ||
		!exact(value, [
			'schemaVersion',
			'productCode',
			'version',
			'currency',
			...PRICE_FIELDS,
			'includedSeats',
			'trialSeatLimit',
			'trialDays',
			'graceDays',
			'createdAt'
		]) ||
		value.schemaVersion !== 1 ||
		value.productCode !== 'WINCRM' ||
		value.currency !== 'RUB' ||
		!integer(value.version, 1) ||
		value.trialDays !== 5 ||
		value.graceDays !== 3 ||
		!PRICE_FIELDS.every(key => integer(value[key], 1, 100_000_000)) ||
		!integer(value.includedSeats, 2, 10_000) ||
		!integer(value.trialSeatLimit, 2, 10_000) ||
		!isoDate(value.createdAt)
	)
		return invalid()
	return { ...value } as unknown as CrmCommercialPolicy
}

const ROLE = ['OWNER', 'MEMBER']
const STATUS = [
	'NOT_ACTIVATED',
	'ACTIVE',
	'GRACE',
	'READ_ONLY',
	'SUSPENDED',
	'EXPIRED',
	'CANCELLED'
]
const LIFECYCLE = ['ONBOARDING', 'ACTIVE', 'READ_ONLY', 'SUSPENDED']

/** Read-only adapter for crm-access/bootstrap; it never grants product access. */
export function parseCrmProfileStatus(value: unknown): CrmProfileStatus {
	if (
		!isRecord(value) ||
		value.schemaVersion !== 1 ||
		!Array.isArray(value.workspaces) ||
		value.workspaces.length < 1 ||
		value.workspaces.length > 1000
	)
		return invalid()
	const workspaces: Record<string, unknown>[] = []
	const workspaceIds = new Set<string>()
	const membershipIds = new Set<string>()
	for (const item of value.workspaces) {
		if (
			!isRecord(item) ||
			!exact(item, ['workspaceId', 'membershipId', 'role']) ||
			!uuid(item.workspaceId) ||
			!uuid(item.membershipId) ||
			typeof item.role !== 'string' ||
			!ROLE.includes(item.role) ||
			workspaceIds.has(item.workspaceId) ||
			membershipIds.has(item.membershipId)
		)
			return invalid()
		workspaceIds.add(item.workspaceId)
		membershipIds.add(item.membershipId)
		workspaces.push(item)
	}
	if (value.state === 'WORKSPACE_SELECTION_REQUIRED') {
		if (
			!exact(value, [
				'schemaVersion',
				'state',
				'selectedWorkspaceId',
				'workspaces'
			]) ||
			value.selectedWorkspaceId !== null
		)
			return invalid()
		return {
			label: 'Выберите рабочее пространство',
			tone: 'neutral',
			expiresAt: null
		}
	}
	if (
		!exact(value, [
			'schemaVersion',
			'state',
			'selectedWorkspaceId',
			'membership',
			'workspaces',
			'entitlementStatus',
			'entitlement',
			'access'
		]) ||
		!uuid(value.selectedWorkspaceId) ||
		typeof value.state !== 'string' ||
		![...STATUS, 'ONBOARDING'].includes(value.state) ||
		typeof value.entitlementStatus !== 'string' ||
		!STATUS.includes(value.entitlementStatus) ||
		!isRecord(value.membership) ||
		!exact(value.membership, ['membershipId', 'role'])
	)
		return invalid()
	const membership = value.membership
	if (
		!workspaces.some(
			item =>
				item.workspaceId === value.selectedWorkspaceId &&
				item.membershipId === membership.membershipId &&
				item.role === membership.role
		)
	)
		return invalid()
	let lifecycle: string | null = null
	if (value.access !== null) {
		if (
			!isRecord(value.access) ||
			!exact(value.access, ['lifecycle']) ||
			typeof value.access.lifecycle !== 'string' ||
			!LIFECYCLE.includes(value.access.lifecycle)
		)
			return invalid()
		lifecycle = value.access.lifecycle
	}
	if (value.entitlementStatus === 'NOT_ACTIVATED') {
		if (
			value.state !== 'NOT_ACTIVATED' ||
			value.entitlement !== null ||
			value.access !== null
		)
			return invalid()
		return { label: 'Не подключена', tone: 'neutral', expiresAt: null }
	}
	const entitlement = value.entitlement
	if (
		!isRecord(entitlement) ||
		!exact(entitlement, [
			'id',
			'workspaceId',
			'planCode',
			'seatLimit',
			'policyVersion',
			'graceUntil',
			'trialStartedAt',
			'effectiveFrom',
			'effectiveUntil',
			'aggregateVersion',
			'sourceSequence'
		]) ||
		!uuid(entitlement.id) ||
		entitlement.workspaceId !== value.selectedWorkspaceId ||
		typeof entitlement.planCode !== 'string' ||
		entitlement.planCode.trim().length < 1 ||
		entitlement.planCode.length > 64 ||
		!isoDate(entitlement.effectiveFrom) ||
		!isoDate(entitlement.effectiveUntil) ||
		entitlement.effectiveFrom > entitlement.effectiveUntil ||
		!positiveDecimal(entitlement.aggregateVersion) ||
		!positiveDecimal(entitlement.sourceSequence) ||
		(entitlement.seatLimit !== null &&
			!integer(entitlement.seatLimit, 1)) ||
		(entitlement.policyVersion !== null &&
			!integer(entitlement.policyVersion, 1)) ||
		(entitlement.graceUntil !== null &&
			!isoDate(entitlement.graceUntil)) ||
		(entitlement.policyVersion === null
			? entitlement.graceUntil !== null
			: !isoDate(entitlement.graceUntil) ||
				entitlement.graceUntil <= entitlement.effectiveUntil ||
				!integer(entitlement.seatLimit, 2)) ||
		(entitlement.trialStartedAt !== null &&
			!isoDate(entitlement.trialStartedAt)) ||
		(entitlement.planCode === 'TRIAL' &&
			!isoDate(entitlement.trialStartedAt)) ||
		(isoDate(entitlement.trialStartedAt) &&
			entitlement.trialStartedAt > entitlement.effectiveUntil)
	)
		return invalid()
	const expectedState =
		lifecycle === 'SUSPENDED'
			? 'SUSPENDED'
			: !['ACTIVE', 'GRACE'].includes(value.entitlementStatus)
				? value.entitlementStatus
				: value.state === 'ONBOARDING' &&
					  (lifecycle === null || lifecycle === 'ONBOARDING')
					? 'ONBOARDING'
					: lifecycle === 'READ_ONLY'
						? 'READ_ONLY'
						: lifecycle === 'ACTIVE'
							? value.entitlementStatus
							: null
	if (value.state !== expectedState) return invalid()
	const labels: Record<string, string> = {
		ONBOARDING: 'Настройка',
		ACTIVE:
			entitlement.planCode === 'TRIAL' ? 'Пробный период' : 'Активна',
		GRACE: 'Льготный период',
		READ_ONLY: 'Только просмотр',
		SUSPENDED: 'Приостановлена',
		EXPIRED: 'Истекла',
		CANCELLED: 'Отключена'
	}
	return {
		label: labels[value.state],
		tone:
			value.state === 'ACTIVE'
				? 'active'
				: ['GRACE', 'READ_ONLY', 'SUSPENDED', 'EXPIRED'].includes(
							value.state
					  )
					? 'warning'
					: 'neutral',
		expiresAt:
			value.state === 'GRACE'
				? (entitlement.graceUntil as string | null)
				: ['ACTIVE', 'ONBOARDING'].includes(value.state)
					? entitlement.effectiveUntil
					: null
	}
}
