export type CrmNavigationIcon =
	| 'clock'
	| 'inbox'
	| 'deals'
	| 'tasks'
	| 'contacts'
	| 'analytics'
	| 'settings'

export interface CrmNavigationItem {
	href: string
	icon: CrmNavigationIcon
	label: string
}

export const CRM_NAVIGATION = [
	{
		href: '/my-day',
		icon: 'clock',
		label: 'Мой день'
	},
	{
		href: '/inbox',
		icon: 'inbox',
		label: 'Входящие'
	},
	{
		href: '/deals',
		icon: 'deals',
		label: 'Сделки'
	},
	{
		href: '/tasks',
		icon: 'tasks',
		label: 'Задачи'
	},
	{
		href: '/contacts',
		icon: 'contacts',
		label: 'Контакты'
	},
	{
		href: '/analytics',
		icon: 'analytics',
		label: 'Аналитика'
	},
	{
		href: '/settings',
		icon: 'settings',
		label: 'Настройки'
	}
] as const satisfies readonly CrmNavigationItem[]
