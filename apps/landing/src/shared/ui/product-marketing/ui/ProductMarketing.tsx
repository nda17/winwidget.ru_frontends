import { CRM_RELEASE } from '@/shared/config/crm-release.config'
import type { PropsWithChildren, ReactNode } from 'react'
import { MarketingLink } from './MarketingLink'
import styles from './ProductMarketing.module.scss'

export const MarketingPage = ({ children }: PropsWithChildren) => (
	<div className={styles.page}>{children}</div>
)

export const CrmReleaseBadge = () =>
	CRM_RELEASE.apiEnabled ? null : (
		<span className={styles.releaseBadge}>
			<span aria-hidden="true" />
			{CRM_RELEASE.unavailableLabel}
		</span>
	)

interface MarketingHeroProps {
	eyebrow: string
	title: string
	subtitle: string
	crm?: boolean
	children?: ReactNode
}

export const MarketingHero = ({
	eyebrow,
	title,
	subtitle,
	crm = false,
	children
}: MarketingHeroProps) => (
	<section className={styles.hero} aria-labelledby="product-hero-title">
		<div className={styles.heroGlow} aria-hidden="true" />
		<div className={styles.heroContent}>
			<div className={styles.eyebrowRow}>
				<p className={styles.eyebrow}>
					{crm ? `WinCRM · ${eyebrow}` : eyebrow}
				</p>
				{crm && <CrmReleaseBadge />}
			</div>
			<h1 id="product-hero-title" className={styles.heroTitle}>
				{title}
			</h1>
			<p className={styles.heroSubtitle}>{subtitle}</p>
			{children && <div className={styles.actions}>{children}</div>}
		</div>
	</section>
)

interface MarketingSectionProps extends PropsWithChildren {
	id?: string
	title: string
	subtitle?: string
	soft?: boolean
}

export const MarketingSection = ({
	id,
	title,
	subtitle,
	soft = false,
	children
}: MarketingSectionProps) => (
	<section
		id={id}
		className={`${styles.section} ${soft ? styles.sectionSoft : ''}`}
	>
		<div className={styles.container}>
			<div className={styles.sectionHeading}>
				<h2 className={styles.sectionTitle}>{title}</h2>
				{subtitle && <p className={styles.sectionSubtitle}>{subtitle}</p>}
			</div>
			{children}
		</div>
	</section>
)

interface ProductCardContent {
	description: string
	features: string[]
	buttonText: string
}

export const MarketingProducts = ({
	widgets,
	crm
}: {
	widgets: ProductCardContent
	crm: ProductCardContent
}) => (
	<div className={styles.products}>
		{(['widgets', 'crm'] as const).map(product => {
			const isCrm = product === 'crm'
			const content = isCrm ? crm : widgets
			return (
				<article
					key={product}
					className={`${styles.productCard} ${isCrm ? styles.crmCard : ''}`}
				>
					<div className={styles.productTop}>
						<span className={styles.productSymbol} aria-hidden="true">
							{isCrm ? '◈' : '✳'}
						</span>
						{isCrm && <CrmReleaseBadge />}
					</div>
					<h3 className={styles.productTitle}>
						{isCrm ? 'WinCRM' : 'Widgets'}
					</h3>
					<p className={styles.productDescription}>
						{content.description}
					</p>
					<ul className={styles.productFeatures}>
						{content.features.map((feature, index) => (
							<li key={`${feature}-${index}`}>{feature}</li>
						))}
					</ul>
					<MarketingLink
						href={isCrm ? '/products/crm' : '/products/widgets'}
						secondary={isCrm}
					>
						{content.buttonText}
					</MarketingLink>
				</article>
			)
		})}
	</div>
)

export const MarketingFeatures = ({
	items,
	ordered = false
}: {
	items: { title: string; text: string }[]
	ordered?: boolean
}) => (
	<div className={`${styles.features} ${ordered ? styles.steps : ''}`}>
		{items.map((item, index) => (
			<article className={styles.feature} key={`${item.title}-${index}`}>
				<span className={styles.featureNumber} aria-hidden="true">
					{String(index + 1).padStart(2, '0')}
				</span>
				<h3>{item.title}</h3>
				<p>{item.text}</p>
			</article>
		))}
	</div>
)

export const MarketingNote = ({ children }: PropsWithChildren) => (
	<p className={styles.note}>{children}</p>
)

export const MarketingActions = ({ children }: PropsWithChildren) => (
	<div className={styles.actions}>{children}</div>
)

export const MarketingCta = ({
	title,
	text,
	children
}: PropsWithChildren<{ title: string; text: string }>) => (
	<section className={styles.cta}>
		<div className={styles.ctaInner}>
			<h2 className={styles.sectionTitle}>{title}</h2>
			<p>{text}</p>
			<div className={styles.actions}>{children}</div>
		</div>
	</section>
)

export const MarketingHelp = ({ children }: PropsWithChildren) => (
	<section id="help" className={styles.section}>
		<div className={styles.container}>{children}</div>
	</section>
)
