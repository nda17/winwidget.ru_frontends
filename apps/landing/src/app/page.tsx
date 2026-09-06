import { Home } from '@/screens/home'
import { getAffiliatePublicSettings } from '@/entities/affiliate/server'
import { getHomePageContent } from '@/entities/home-page-content/server'
import { getTariffPrices } from '@/entities/subscription/server'
import { Metadata } from 'next'

export const generateMetadata = async (): Promise<Metadata> => {
	const content = await getHomePageContent()

	return {
		title: content.seo.title,
		description: content.seo.description,
		keywords: content.seo.keywords,
		openGraph: {
			title: content.seo.ogTitle,
			description: content.seo.ogDescription,
			url: 'https://winwidget.ru',
			type: 'website',
			images: [
				{
					url: '/og-image.png',
					width: 1200,
					height: 630,
					alt: 'Winwidget'
				}
			]
		},
		alternates: {
			canonical: 'https://winwidget.ru'
		}
	}
}

const HomePage = async () => {
	const [content, tariffPrices, affiliateSettings] = await Promise.all([
		getHomePageContent(),
		getTariffPrices(),
		getAffiliatePublicSettings()
	])

	return (
		<Home
			content={content}
			tariffPrices={tariffPrices}
			affiliateSettings={affiliateSettings}
		/>
	)
}

export default HomePage
