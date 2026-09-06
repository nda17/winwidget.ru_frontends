import type { HomePageContent } from '@/entities/home-page-content'
import {
	MarketingActions,
	MarketingCta,
	MarketingFaq,
	MarketingFeatures,
	MarketingHelp,
	MarketingHero,
	MarketingLink,
	MarketingNote,
	MarketingPage,
	MarketingProducts,
	MarketingSection,
	CrmReleaseBadge
} from '@/shared/ui/product-marketing'
import { LegacyWidgetAnchors } from './LegacyWidgetAnchors'

interface EcosystemProps {
	content: HomePageContent['ecosystem']
}

export const Ecosystem = ({ content }: EcosystemProps) => (
	<MarketingPage>
		<LegacyWidgetAnchors />
		<MarketingHero {...content.hero}>
			<MarketingLink href="/products/widgets">
				{content.products.widgets.buttonText}
			</MarketingLink>
			<MarketingLink href="/products/crm" secondary>
				{content.products.crm.buttonText}
			</MarketingLink>
		</MarketingHero>
		<MarketingSection
			id="products"
			title={content.products.title}
			subtitle={content.products.subtitle}
		>
			<MarketingProducts
				widgets={content.products.widgets}
				crm={content.products.crm}
			/>
		</MarketingSection>
		{content.integration.enabled && (
			<MarketingSection
				title={content.integration.title}
				subtitle={content.integration.subtitle}
				soft
			>
				<MarketingFeatures items={content.integration.items} ordered />
				<MarketingNote>{content.integration.note}</MarketingNote>
			</MarketingSection>
		)}
		{content.plans.enabled && (
			<MarketingSection
				id="plans"
				title={content.plans.title}
				subtitle={content.plans.subtitle}
			>
				<MarketingActions>
					<MarketingLink href="/products/widgets#pricing">
						{content.plans.widgetsButtonText}
					</MarketingLink>
					<MarketingLink href="/products/crm" secondary>
						{content.plans.crmButtonText}
					</MarketingLink>
					<CrmReleaseBadge />
				</MarketingActions>
				<MarketingNote>{content.plans.note}</MarketingNote>
			</MarketingSection>
		)}
		{content.faq.enabled && (
			<MarketingHelp>
				<MarketingFaq
					title={content.faq.title}
					items={content.faq.items}
				/>
			</MarketingHelp>
		)}
		{content.cta.enabled && (
			<MarketingCta title={content.cta.title} text={content.cta.text}>
				<MarketingLink href="/products/widgets">
					{content.cta.widgetsButtonText}
				</MarketingLink>
				<MarketingLink href="/products/crm" secondary>
					{content.cta.crmButtonText}
				</MarketingLink>
			</MarketingCta>
		)}
	</MarketingPage>
)
