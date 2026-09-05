import type {
	IAdminNavGroup,
	INavItem
} from '@/screens/admin/ui/common/admin-navigation/admin-navigation.interface'
import { ADMIN_PAGES } from '@/shared/config/pages/admin.config'

export const adminNavGroups: IAdminNavGroup[] = [
	{
		id: 'overview',
		title: 'Обзор',
		description: 'Показатели платформы и события, требующие внимания.',
		items: [
			{ title: 'Статистика', link: ADMIN_PAGES.HOME },
			{ title: 'Предупреждения', link: ADMIN_PAGES.ALERTS }
		]
	},
	{
		id: 'products',
		title: 'Клиенты и продукты',
		description:
			'Общие аккаунты и независимые продукты WinWidget и WinCRM.',
		items: [
			{
				title: 'Пользователи',
				link: ADMIN_PAGES.USER_LIST,
				option: ADMIN_PAGES.USER
			},
			{ title: 'Рабочее приложение WinWidget', link: ADMIN_PAGES.WIDGETS },
			{ title: 'WinCRM', link: ADMIN_PAGES.CRM }
		]
	},
	{
		id: 'finance',
		title: 'Финансы',
		description:
			'Платежи, подписки и тарифы Widgets. Условия WinCRM — на странице продукта.',
		items: [
			{ title: 'Платежи', link: ADMIN_PAGES.PAYMENTS },
			{ title: 'Подписки Widgets', link: ADMIN_PAGES.SUBSCRIPTIONS },
			{ title: 'Тарифы Widgets', link: ADMIN_PAGES.TARIFFS },
			{ title: 'Партнёрская программа', link: ADMIN_PAGES.AFFILIATE }
		]
	},
	{
		id: 'content',
		title: 'Контент и связь',
		description: 'Публичный сайт, документы и каналы коммуникации.',
		items: [
			{ title: 'Контент', link: ADMIN_PAGES.CONTENT },
			{ title: 'Рассылки', link: ADMIN_PAGES.MAILINGS },
			{ title: 'Telegram-боты', link: ADMIN_PAGES.TELEGRAM_BOT }
		]
	},
	{
		id: 'operations',
		title: 'Эксплуатация',
		description: 'Состояние сервисов, доставка событий и резервные копии.',
		items: [
			{ title: 'Система', link: ADMIN_PAGES.SYSTEM },
			{ title: 'Очереди', link: ADMIN_PAGES.MESSAGING },
			{ title: 'Базы данных', link: ADMIN_PAGES.DATABASES }
		]
	},
	{
		id: 'management',
		title: 'Управление',
		description: 'Настройки платформы, безопасность и аудит действий.',
		items: [
			{ title: 'Настройки', link: ADMIN_PAGES.SETTINGS },
			{ title: 'Журнал событий', link: ADMIN_PAGES.EVENT_LOG }
		]
	}
]

export const isAdminNavItemActive = (pathname: string, item: INavItem) =>
	pathname === item.link ||
	(item.link !== ADMIN_PAGES.HOME &&
		pathname.startsWith(`${item.link}/`)) ||
	Boolean(
		item.option &&
		(pathname === item.option || pathname.startsWith(`${item.option}/`))
	)
