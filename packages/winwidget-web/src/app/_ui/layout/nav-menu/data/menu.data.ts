import { IMenu } from '@/app/_ui/layout/nav-menu/desktop/menu/menu.interface'
import { PUBLIC_PAGES } from '@/shared/config/pages/public.config'
import { CRM_RELEASE } from '@/shared/config/crm-release.config'

export const staticMenu: IMenu = {
	items: [
		{
			icon: 'home',
			link: PUBLIC_PAGES.HOME,
			title: 'Главная'
		},
		{
			icon: 'dashboard',
			link: CRM_RELEASE.appUrl,
			title: 'CRM'
		}
	]
}
