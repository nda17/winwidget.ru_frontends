import {
	staticMenu,
	usesApplicationMenu
} from '@/app/_ui/layout/nav-menu/data/menu.data'
import styles from '@/app/_ui/layout/nav-menu/desktop/menu/desktop-static-menu/DesktopStaticMenu.module.scss'
import MenuItem from '@/app/_ui/layout/nav-menu/desktop/menu/menu-item/MenuItem'
import { IMenuItem } from '@/app/_ui/layout/nav-menu/menu-item.interface'
import { NextPage } from 'next'
import { usePathname } from 'next/navigation'
import { currentFrontendZone } from '@/shared/lib/navigation/frontend-zones'
import ProductSwitch from '@/app/_ui/layout/nav-menu/product-switch/ProductSwitch'

const DesktopStaticMenu: NextPage = () => {
	const application = usesApplicationMenu(
		usePathname(),
		currentFrontendZone()
	)
	return (
		<ul className={styles.wrapper}>
			{application ? (
				<li>
					<ProductSwitch />
				</li>
			) : (
				staticMenu.items?.map((item: IMenuItem) => (
					<MenuItem item={item} key={item.link} />
				))
			)}
		</ul>
	)
}

export default DesktopStaticMenu
