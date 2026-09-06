import { CrmProduct } from '@/screens/crm-product'
import { getHomePageContent } from '@/entities/home-page-content/server'
import { productMetadata } from '@/app/_lib/product-metadata'
import type { Metadata } from 'next'

export const generateMetadata = async (): Promise<Metadata> => {
	const content = await getHomePageContent()
	return productMetadata(content.crmProduct.seo, '/products/crm')
}

const CrmProductPage = async () => {
	const content = await getHomePageContent()
	return <CrmProduct content={content.crmProduct} />
}

export default CrmProductPage
