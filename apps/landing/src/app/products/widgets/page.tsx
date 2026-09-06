import { Home } from '@/screens/home'
import { getAffiliatePublicSettings } from '@/entities/affiliate/server'
import { getHomePageContent } from '@/entities/home-page-content/server'
import { getTariffPrices } from '@/entities/subscription/server'
import { productMetadata } from '@/app/_lib/product-metadata'
import type { Metadata } from 'next'

export const generateMetadata = async (): Promise<Metadata> => {
	const content = await getHomePageContent()
	return productMetadata(content.seo, '/products/widgets')
}

const WidgetsProductPage = async () => {
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

export default WidgetsProductPage
