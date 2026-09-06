'use client'

import Link from '@/shared/lib/navigation/ZoneLink'
import type { ReactNode } from 'react'
import toast from 'react-hot-toast'
import styles from './ProductMarketing.module.scss'

interface MarketingLinkProps {
	href: string
	children: ReactNode
	secondary?: boolean
}

export const MarketingLink = ({
	href,
	children,
	secondary = false
}: MarketingLinkProps) => (
	<Link
		href={href}
		className={`${styles.link} ${secondary ? styles.linkSecondary : ''}`}
		onClick={event => {
			if (
				event.button === 0 &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.shiftKey &&
				!event.altKey
			) {
				toast('Открываем страницу', { id: 'product-navigation' })
			}
		}}
	>
		<span>{children}</span>
		<span aria-hidden="true">↗</span>
	</Link>
)
