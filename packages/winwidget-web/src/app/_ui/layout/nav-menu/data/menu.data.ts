import { IMenu } from '@/app/_ui/layout/nav-menu/desktop/menu/menu.interface'
import { PUBLIC_PAGES } from '@/shared/config/pages/public.config'
import type { FrontendZone } from '@/shared/lib/navigation/frontend-zones'

export const usesApplicationMenu = (
	pathname: string,
	zone: FrontendZone
) =>
	zone !== 'landing' &&
	!/^\/(login|register|restore-password|social-auth|logout)(?:\/|$)/.test(
		pathname
	)

export const staticMenu: IMenu = {
	items: [
		{
			icon: 'apps',
			link: PUBLIC_PAGES.WIDGETS_PRODUCT,
			title: 'Виджеты'
		},
		{
			icon: 'dashboard',
			link: PUBLIC_PAGES.CRM_PRODUCT,
			title: 'WinCRM'
		},
		{
			icon: 'diamond',
			link: PUBLIC_PAGES.PLANS,
			title: 'Тарифы'
		},
		{
			icon: 'help',
			link: PUBLIC_PAGES.HELP,
			title: 'Помощь'
		}
	]
}
