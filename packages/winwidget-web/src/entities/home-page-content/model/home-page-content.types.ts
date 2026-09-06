export type HomePageToolPreviewType =
	| 'wheel'
	| 'quiz'
	| 'callback'
	| 'timer'
	| 'aiConsultant'
	| 'stopOffer'
	| 'calculator'
	| 'none'

export type HomePageIntegrationIconKey =
	| 'email'
	| 'telegram'
	| 'webhook'
	| 'bitrix'
	| 'amocrm'
	| 'metrika'
	| 'vk'
	| 'roistat'

export interface HomePageContentRecord {
	id: string
	content: HomePageContent
	updatedAt: string
}

export interface HomePageContent {
	ecosystem: EcosystemPageContent
	crmProduct: CrmProductPageContent
	seo: HomePageSeoContent
	technicalSeo: HomePageTechnicalSeoContent
	demoWidgets: HomePageDemoWidgetsContent
	hero: HomePageHeroContent
	analysis: HomePageAnalysisContent
	integrations: HomePageIntegrationsContent
	tools: HomePageToolsContent
	audiences: HomePageAudiencesContent
	caseStudies: HomePageCaseStudiesContent
	leadFlow: HomePageLeadFlowContent
	whyWidgets: HomePageWhyWidgetsContent
	steps: HomePageStepsContent
	customization: HomePageCustomizationContent
	dashboardPreview: HomePageDashboardPreviewContent
	directLink: HomePageDirectLinkContent
	security: HomePageSecurityContent
	subscriptionBundle: HomePageSubscriptionBundleContent
	tariffComparison: HomePageTariffComparisonContent
	pricing: HomePagePricingContent
	microCta: HomePageMicroCtaContent
	seoText: HomePageSeoTextContent
	payment: HomePagePaymentContent
	faq: HomePageFaqContent
	cta: HomePageCtaContent
	footer: HomePageFooterContent
	head: HomePageHeadContent
	body: HomePageBodyContent
}

export type StructuredHomePageContent = Omit<
	HomePageContent,
	'head' | 'body'
>

export type RawHomePageContent = Pick<HomePageContent, 'head' | 'body'>

export interface HomePageSeoContent {
	title: string
	description: string
	keywords: string[]
	ogTitle: string
	ogDescription: string
}

export interface ProductMarketingSection {
	enabled: boolean
	title: string
	subtitle: string
	items: HomePageFeatureCard[]
}

export interface ProductMarketingIntegration extends ProductMarketingSection {
	note: string
}

export interface ProductMarketingFaq {
	enabled: boolean
	title: string
	items: { question: string; answer: string }[]
}

export interface EcosystemPageContent {
	seo: HomePageSeoContent
	hero: { eyebrow: string; title: string; subtitle: string }
	products: {
		title: string
		subtitle: string
		widgets: {
			description: string
			features: string[]
			buttonText: string
		}
		crm: { description: string; features: string[]; buttonText: string }
	}
	integration: ProductMarketingIntegration
	plans: {
		enabled: boolean
		title: string
		subtitle: string
		widgetsButtonText: string
		crmButtonText: string
		note: string
	}
	faq: ProductMarketingFaq
	cta: {
		enabled: boolean
		title: string
		text: string
		widgetsButtonText: string
		crmButtonText: string
	}
}

export interface CrmProductPageContent {
	seo: HomePageSeoContent
	hero: {
		eyebrow: string
		title: string
		subtitle: string
		buttonText: string
	}
	features: ProductMarketingSection
	workflow: ProductMarketingSection
	integration: ProductMarketingIntegration
	faq: ProductMarketingFaq
	cta: {
		enabled: boolean
		title: string
		text: string
		buttonText: string
	}
}

export type HomePageSitemapChangeFrequency =
	| 'always'
	| 'hourly'
	| 'daily'
	| 'weekly'
	| 'monthly'
	| 'yearly'
	| 'never'

export interface HomePageTechnicalSeoContent {
	baseUrl: string
	robotsDisallow: string[]
	sitemapItems: HomePageSitemapItem[]
}

export interface HomePageSitemapItem {
	path: string
	changeFrequency: HomePageSitemapChangeFrequency
	priority: number
	enabled: boolean
}

export interface HomePageDemoWidgetsContent {
	enabled: boolean
	bubbleTexts: {
		wheel: string
		quiz: string
		callback: string
		countdown: string
		aiConsultant: string
		stopOffer: string
		calculator: string
	}
}

export interface HomePageHeroContent {
	titleBeforeAccent: string
	accentText: string
	titleAfterAccent: string
	subtitle: string
	primaryButtonText: string
	faqButtonLabel: string
	benefits: HomePageTextCard[]
}

export interface HomePageAnalysisContent {
	enabled: boolean
	title: string
	subtitle: string
	cards: HomePageTextCard[]
}

export interface HomePageIntegrationsContent {
	enabled: boolean
	title: string
	items: HomePageIntegrationItem[]
}

export interface HomePageIntegrationItem {
	title: string
	tag: string
	description: string
	iconKey: HomePageIntegrationIconKey
}

export interface HomePageToolsContent {
	enabled: boolean
	title: string
	ctaText: string
	items: HomePageToolItem[]
}

export interface HomePageToolItem {
	title: string
	description: string
	comingSoon: boolean
	previewType: HomePageToolPreviewType
}

export interface HomePageAudiencesContent {
	enabled: boolean
	title: string
	subtitle: string
	items: HomePageFeatureCard[]
}

export interface HomePageCaseStudiesContent {
	enabled: boolean
	title: string
	subtitle: string
	items: HomePageCaseStudy[]
}

export interface HomePageCaseStudy {
	title: string
	text: string
	result: string
}

export interface HomePageLeadFlowContent {
	enabled: boolean
	title: string
	subtitle: string
	items: HomePageFeatureCard[]
}

export interface HomePageWhyWidgetsContent {
	enabled: boolean
	title: string
	subtitle: string
	formTitle: string
	widgetTitle: string
	formItems: HomePageTextCard[]
	widgetItems: HomePageTextCard[]
}

export interface HomePageStepsContent {
	enabled: boolean
	title: string
	resultText: string
	items: HomePageTextCard[]
}

export interface HomePageTextCard {
	text: string
}

export interface HomePageFeatureCard {
	title: string
	text: string
}

export interface HomePageCustomizationContent {
	enabled: boolean
	title: string
	subtitle: string
	cards: HomePageFeatureCard[]
	features: HomePageTextCard[]
	bottomText: string
}

export interface HomePageDashboardPreviewContent {
	enabled: boolean
	title: string
	subtitle: string
	cards: HomePageFeatureCard[]
	metrics: HomePageFeatureCard[]
}

export interface HomePageDirectLinkContent {
	enabled: boolean
	title: string
	subtitle: string
	items: HomePageFeatureCard[]
}

export interface HomePageSecurityContent {
	enabled: boolean
	title: string
	subtitle: string
	items: HomePageFeatureCard[]
}

export interface HomePageSubscriptionBundleContent {
	enabled: boolean
	title: string
	subtitle: string
	cardTitle: string
	items: HomePageTextCard[]
}

export interface HomePageTariffComparisonContent {
	enabled: boolean
	title: string
	subtitle: string
	rows: HomePageTariffComparisonRow[]
}

export interface HomePageTariffComparisonRow {
	feature: string
	easy: string
	hard: string
}

export interface HomePagePricingContent {
	enabled: boolean
	title: string
	monthlyToggleText: string
	yearlyToggleText: string
	discountText: string
	buttonText: string
	plans: HomePagePricingPlan[]
}

export interface HomePagePricingPlan {
	key: string
	badge: string
	title: string
	subtitle: string
	features: string[]
	monthly: HomePagePlanPrice
	yearly: HomePagePlanPrice
	star: boolean
	popular: boolean
}

export interface HomePagePlanPrice {
	price: string
	priceNote: string
	yearlyTotal?: string
}

export interface HomePageMicroCtaContent {
	enabled: boolean
	afterIntegrationsText: string
	afterIntegrationsButtonText: string
	afterStepsText: string
	afterStepsButtonText: string
}

export interface HomePageSeoTextContent {
	enabled: boolean
	title: string
	text: string
}

export interface HomePagePaymentContent {
	seoTitle: string
	seoDescription: string
}

export interface HomePageFaqContent {
	enabled: boolean
	title: string
	items: HomePageFaqItem[]
}

export interface HomePageFaqItem {
	question: string
	answerHtml: string
}

export interface HomePageCtaContent {
	enabled: boolean
	text: string
	buttonText: string
	benefits: HomePageTextCard[]
}

export interface HomePageFooterContent {
	aboutTitle: string
	infoLines: string[]
	email: string
	ybsUrl: string
	vkUrl: string
	telegramUrl: string
	vkAriaLabel: string
	telegramAriaLabel: string
	legalDisclaimer: string
}

export interface HomePageBodyContent {
	enabled: boolean
	html: string
}

export interface HomePageHeadContent {
	enabled: boolean
	html: string
}
