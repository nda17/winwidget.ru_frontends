'use client'

import styles from '@/widgets/crm-app-shell/ui/CrmAppShell.module.scss'
import {
	CRM_NAVIGATION,
	type CrmNavigationItem
} from '@/widgets/crm-app-shell/model/crm-navigation'
import { useCrmWorkspaceAccess } from '@/entities/crm-access'
import { getRuntimeConfig } from '@/shared/config/runtime'
import {
	AppIcon,
	BrandLogo,
	Drawer,
	ReadOnlyBanner,
	StatusBadge
} from '@/shared/ui'
import clsx from 'clsx'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
	type KeyboardEvent,
	type PropsWithChildren,
	useRef,
	useState
} from 'react'
import toast from 'react-hot-toast'

interface CrmNavigationProps {
	ariaLabel: string
	onNavigate?: () => void
}

const isNavigationItemActive = (
	pathname: string,
	item: CrmNavigationItem
) => pathname === item.href || pathname.startsWith(`${item.href}/`)

const CrmNavigation = ({ ariaLabel, onNavigate }: CrmNavigationProps) => {
	const pathname = usePathname()

	return (
		<nav aria-label={ariaLabel}>
			<ul className={styles.navigationList}>
				{CRM_NAVIGATION.map(item => {
					const isActive = isNavigationItemActive(pathname, item)

					return (
						<li key={item.href}>
							<Link
								href={item.href}
								className={clsx(
									styles.navigationLink,
									isActive && styles.navigationLinkActive
								)}
								aria-current={isActive ? 'page' : undefined}
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
									onNavigate?.()
									if (!isActive)
										toast(`Переход в раздел «${item.label}»`, {
											id: 'crm-navigation'
										})
								}}
							>
								<span className={styles.navigationIcon}>
									<AppIcon name={item.icon} size={20} />
								</span>
								<span>{item.label}</span>
							</Link>
						</li>
					)
				})}
			</ul>
		</nav>
	)
}

const CrmMobileNavigation = () => {
	const [isOpen, setIsOpen] = useState(false)

	return (
		<>
			<button
				type="button"
				className={styles.mobileMenuButton}
				aria-label="Открыть навигацию CRM"
				aria-expanded={isOpen}
				onClick={() => setIsOpen(true)}
			>
				<AppIcon name="menu" size={20} />
			</button>

			<Drawer
				isOpen={isOpen}
				onClose={() => setIsOpen(false)}
				title="Навигация CRM"
				side="left"
			>
				<div className={styles.mobileNavigation}>
					<CrmNavigation
						ariaLabel="Мобильная навигация CRM"
						onNavigate={() => setIsOpen(false)}
					/>
					<p className={styles.mobileCaption}>
						WinCRM · рабочее пространство
					</p>
				</div>
			</Drawer>
		</>
	)
}

const CrmProductSwitch = () => {
	const details = useRef<HTMLDetailsElement>(null)
	const closeWithEscape = (event: KeyboardEvent<HTMLElement>) => {
		if (event.key !== 'Escape' || !details.current) return
		details.current.open = false
		details.current.querySelector('summary')?.focus()
	}
	const widgetsUrl = new URL(
		'/cabinet',
		getRuntimeConfig().mainAppOrigin
	).toString()

	return (
		<details
			ref={details}
			className={styles.productSwitch}
			onBlur={event => {
				if (!event.currentTarget.contains(event.relatedTarget))
					event.currentTarget.open = false
			}}
		>
			<summary
				className={styles.productSwitchTrigger}
				onKeyDown={closeWithEscape}
			>
				<span>WinCRM</span>
				<AppIcon name="chevronDown" size={16} aria-hidden="true" />
			</summary>
			<nav
				className={styles.productSwitchPanel}
				aria-label="Рабочие приложения"
			>
				<p>Один аккаунт · отдельные продукты</p>
				<a
					href={widgetsUrl}
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
						toast('Переход в WinWidget', { id: 'product-navigation' })
					}}
				>
					<strong>WinWidget</strong>
					<span>Виджеты и заявки</span>
				</a>
				<Link
					href="/inbox"
					aria-current="true"
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
						toast('Переход в WinCRM', { id: 'product-navigation' })
					}}
				>
					<strong>WinCRM</strong>
					<span>Клиенты и продажи</span>
				</Link>
			</nav>
		</details>
	)
}

const CrmAppShell = ({ children }: PropsWithChildren) => {
	const pathname = usePathname()
	const access = useCrmWorkspaceAccess()
	const section =
		CRM_NAVIGATION.find(item => isNavigationItemActive(pathname, item))
			?.label ?? 'Рабочее пространство'
	const accessLabel =
		access.state === 'READ_ONLY'
			? 'Только чтение'
			: access.state === 'GRACE'
				? 'Льготный период'
				: 'Доступ активен'
	const membershipLabel =
		access.membership.role === 'OWNER'
			? 'Владелец пространства'
			: 'Участник пространства'

	return (
		<div className={styles.shell}>
			<a className={styles.skipLink} href="#crm-main-content">
				Перейти к содержимому
			</a>

			<aside className={styles.sidebar} aria-label="CRM">
				<div className={styles.sidebarBrand}>
					<BrandLogo href="/inbox" />
				</div>
				<div className={styles.sidebarNavigation}>
					<CrmNavigation ariaLabel="Основная навигация CRM" />
				</div>
				<p className={styles.sidebarCaption}>
					WinCRM · рабочее пространство
				</p>
			</aside>

			<div className={styles.workspace}>
				<header className={styles.topbar}>
					<CrmMobileNavigation key={pathname} />

					<div
						className={styles.sectionContext}
						aria-label="Текущий раздел"
					>
						<span className={styles.productName}>WinCRM</span>
						<span className={styles.sectionName}>{section}</span>
					</div>
					<CrmProductSwitch />

					<div
						className={styles.accessContext}
						aria-label="Доступ к рабочему пространству"
					>
						<StatusBadge
							tone={
								access.state === 'ACTIVE'
									? 'success'
									: access.state === 'GRACE'
										? 'warning'
										: 'neutral'
							}
						>
							{accessLabel}
						</StatusBadge>
						<StatusBadge tone="neutral" showDot={false}>
							{membershipLabel}
						</StatusBadge>
					</div>
				</header>

				<main
					id="crm-main-content"
					className={styles.content}
					tabIndex={-1}
				>
					{access.state === 'GRACE' ? (
						<ReadOnlyBanner
							tone="warning"
							title="Дополнительные 3 дня доступа"
							description={
								<>
									Бесплатный период завершён. Вы можете продолжать работу
									{access.entitlement.graceUntil ? (
										<>
											{' '}
											до{' '}
											<time dateTime={access.entitlement.graceUntil}>
												{new Intl.DateTimeFormat('ru-RU', {
													dateStyle: 'long',
													timeStyle: 'short'
												}).format(new Date(access.entitlement.graceUntil))}
											</time>
										</>
									) : (
										' в течение льготного периода'
									)}
									. Затем CRM останется доступна для просмотра и экспорта.
								</>
							}
						/>
					) : null}
					{access.isReadOnly ? (
						<ReadOnlyBanner
							title="WinCRM доступна только для чтения"
							description="Данные сохранены. Просмотр доступен, а экспорт — пользователям с соответствующими правами. Для изменений и приёма новых заявок продлите доступ."
						/>
					) : null}
					{children}
				</main>
			</div>
		</div>
	)
}

export default CrmAppShell
