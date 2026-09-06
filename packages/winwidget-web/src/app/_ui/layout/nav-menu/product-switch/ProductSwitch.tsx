'use client'

import { type KeyboardEvent, useRef } from 'react'
import toast from 'react-hot-toast'
import { PUBLIC_PAGES } from '@/shared/config/pages/public.config'
import { getCrmAppUrl } from '@/shared/config/crm-release.config'
import { currentFrontendZone } from '@/shared/lib/navigation/frontend-zones'
import Link from '@/shared/lib/navigation/ZoneLink'
import AppIcon from '@/shared/ui/icons/AppIcon'
import styles from './ProductSwitch.module.scss'

const ProductSwitch = ({ onNavigate }: { onNavigate?: () => void }) => {
	const details = useRef<HTMLDetailsElement>(null)
	const closeWithEscape = (event: KeyboardEvent<HTMLElement>) => {
		if (event.key !== 'Escape' || !details.current) return
		details.current.open = false
		details.current.querySelector('summary')?.focus()
	}
	const isWidgets = currentFrontendZone() === 'widgets'
	const items = [
		{
			label: 'WinWidget',
			description: 'Виджеты и заявки',
			href: PUBLIC_PAGES.CABINET,
			current: isWidgets
		},
		{
			label: 'WinCRM',
			description: 'Клиенты и продажи',
			href: getCrmAppUrl(),
			current: false
		}
	]

	return (
		<details
			ref={details}
			className={styles.switch}
			onBlur={event => {
				if (!event.currentTarget.contains(event.relatedTarget))
					event.currentTarget.open = false
			}}
		>
			<summary className={styles.trigger} onKeyDown={closeWithEscape}>
				<AppIcon name="apps" size={18} aria-hidden="true" />
				<span>{isWidgets ? 'WinWidget' : 'Приложения'}</span>
				<AppIcon
					name="navigate-next"
					size={16}
					className={styles.arrow}
					aria-hidden="true"
				/>
			</summary>
			<nav className={styles.panel} aria-label="Рабочие приложения">
				<p className={styles.caption}>Один аккаунт · отдельные продукты</p>
				{items.map(item => (
					<Link
						key={item.label}
						href={item.href}
						className={styles.item}
						aria-current={item.current ? 'true' : undefined}
						onKeyDown={closeWithEscape}
						onClick={event => {
							if (
								event.defaultPrevented ||
								event.button !== 0 ||
								event.metaKey ||
								event.ctrlKey ||
								event.shiftKey ||
								event.altKey
							)
								return
							if (details.current) details.current.open = false
							onNavigate?.()
							toast(`Переход в ${item.label}`, {
								id: 'product-navigation'
							})
						}}
					>
						<strong>{item.label}</strong>
						<span>{item.description}</span>
					</Link>
				))}
			</nav>
		</details>
	)
}

export default ProductSwitch
