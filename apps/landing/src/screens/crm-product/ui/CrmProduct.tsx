import type { HomePageContent } from '@/entities/home-page-content'
import { getCrmAppUrl } from '@/shared/config/crm-release.config'
import {
	CrmReleaseBadge,
	MarketingCta,
	MarketingFaq,
	MarketingFeatures,
	MarketingHelp,
	MarketingHero,
	MarketingLink,
	MarketingNote,
	MarketingPage,
	MarketingSection
} from '@/shared/ui/product-marketing'

interface CrmProductProps {
	content: HomePageContent['crmProduct']
}

export const CrmProduct = ({ content }: CrmProductProps) => (
	<MarketingPage>
		<MarketingHero {...content.hero} crm>
			<MarketingLink href={getCrmAppUrl()}>
				{content.hero.buttonText}
			</MarketingLink>
		</MarketingHero>
		{content.features.enabled && (
			<MarketingSection
				title={content.features.title}
				subtitle={content.features.subtitle}
			>
				<MarketingFeatures items={content.features.items} />
			</MarketingSection>
		)}
		{content.workflow.enabled && (
			<MarketingSection
				title={content.workflow.title}
				subtitle={content.workflow.subtitle}
				soft
			>
				<MarketingFeatures items={content.workflow.items} ordered />
			</MarketingSection>
		)}
		{content.integration.enabled && (
			<MarketingSection
				title={content.integration.title}
				subtitle={content.integration.subtitle}
			>
				<MarketingFeatures items={content.integration.items} />
				<MarketingNote>{content.integration.note}</MarketingNote>
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
				<MarketingLink href={getCrmAppUrl()}>
					{content.cta.buttonText}
				</MarketingLink>
				<CrmReleaseBadge />
			</MarketingCta>
		)}
	</MarketingPage>
)
