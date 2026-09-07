'use client'

import styles from '@/widgets/crm-app-shell/ui/CrmAppShell.module.scss'
import {
	CRM_NAVIGATION,
	type CrmNavigationItem
} from '@/widgets/crm-app-shell/model/crm-navigation'
import { useCrmWorkspaceAccess } from '@/entities/crm-access'
import { useWorkspaceBranding } from '@/entities/crm-workspace-branding'
import { getRuntimeConfig } from '@/shared/config/runtime'
import { ThemeSwitcher } from '@/shared/ui/theme-switcher/ThemeSwitcher'
import { CrmNavigationLink } from './CrmNavigationLink'
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
	useId,
	useRef,
	useState
} from 'react'

interface CrmNavigationProps {
	ariaLabel: string
	enabled?: boolean
	onNavigate?: () => void
}

const isNavigationItemActive = (
	pathname: string,
	item: CrmNavigationItem
) => pathname === item.href || pathname.startsWith(`${item.href}/`)

const CrmNavigation = ({
	ariaLabel,
	enabled = true,
	onNavigate
}: CrmNavigationProps) => {
	const pathname = usePathname()

	return (
		<nav aria-label={ariaLabel}>
			<ul className={styles.navigationList}>
				{CRM_NAVIGATION.map(item => {
					const isActive = isNavigationItemActive(pathname, item)

					return (
						<li key={item.href}>
							<CrmNavigationLink
								item={item}
								isActive={isActive}
								enabled={enabled}
								onNavigate={onNavigate}
							/>
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
						key={String(isOpen)}
						enabled={isOpen}
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
				title="Рабочие приложения"
			>
				<AppIcon
					name="products"
					size={20}
					className={styles.mobileProductIcon}
				/>
				<span className={styles.productSwitchName}>WinCRM</span>
				<AppIcon
					name="chevronDown"
					size={16}
					className={styles.productSwitchChevron}
					aria-hidden="true"
				/>
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
	const branding = useWorkspaceBranding()
	const companyName = branding.data?.branding.displayName
	const sidebarId = useId()
	const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
	const sidebarToggleLabel = isSidebarCollapsed
		? 'Развернуть боковую панель'
		: 'Свернуть боковую панель'
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
		<div
			className={clsx(
				styles.shell,
				isSidebarCollapsed && styles.shellCollapsed
			)}
		>
			<a className={styles.skipLink} href="#crm-main-content">
				Перейти к содержимому
			</a>

			<aside
				id={sidebarId}
				className={styles.sidebar}
				aria-label="CRM"
				aria-hidden={isSidebarCollapsed || undefined}
				inert={isSidebarCollapsed}
			>
				<div
					className={clsx(
						styles.sidebarContent,
						isSidebarCollapsed && styles.sidebarContentCollapsed
					)}
				>
					<div className={styles.sidebarBrand}>
						<BrandLogo href="/inbox" />
						{companyName ? (
							<span className={styles.companyName} title={companyName}>
								{companyName}
							</span>
						) : null}
					</div>
					<div className={styles.sidebarNavigation}>
						<CrmNavigation
							key={`${pathname}:${isSidebarCollapsed}`}
							enabled={!isSidebarCollapsed}
							ariaLabel="Основная навигация CRM"
						/>
					</div>
					<p className={styles.sidebarCaption}>
						WinCRM · рабочее пространство
					</p>
				</div>
			</aside>

			<div className={styles.workspace}>
				<header className={styles.topbar}>
					<CrmMobileNavigation key={pathname} />
					<button
						type="button"
						className={styles.sidebarToggle}
						aria-label={sidebarToggleLabel}
						title={sidebarToggleLabel}
						aria-controls={sidebarId}
						aria-expanded={!isSidebarCollapsed}
						onClick={event => {
							event.currentTarget.focus({ preventScroll: true })
							setIsSidebarCollapsed(collapsed => !collapsed)
						}}
					>
						<AppIcon
							name="chevronDown"
							size={20}
							className={clsx(
								styles.sidebarToggleIcon,
								isSidebarCollapsed && styles.sidebarToggleIconCollapsed
							)}
						/>
					</button>

					<div
						className={styles.sectionContext}
						aria-label="Текущий раздел"
					>
						<BrandLogo size="compact" className={styles.mobileBrand} />
						{companyName ? (
							<span
								className={styles.mobileCompanyName}
								title={companyName}
							>
								{companyName}
							</span>
						) : null}
						<span className={styles.productName}>WinCRM</span>
						<span className={styles.sectionName}>{section}</span>
					</div>
					<CrmProductSwitch />
					<ThemeSwitcher />

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
							<span className={styles.membershipFull}>
								{membershipLabel}
							</span>
							<span className={styles.membershipShort} aria-hidden="true">
								{access.membership.role === 'OWNER'
									? 'Владелец'
									: 'Участник'}
							</span>
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
