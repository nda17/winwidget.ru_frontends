import type { HomePageSeoContent } from '@/entities/home-page-content'
import type { Metadata } from 'next'

type ProductPagePath = '/' | '/products/widgets' | '/products/crm'

export const productMetadata = (
	seo: HomePageSeoContent,
	path: ProductPagePath
): Metadata => {
	const url = `https://winwidget.ru${path === '/' ? '' : path}`
	return {
		title: { absolute: seo.title },
		description: seo.description,
		keywords: seo.keywords,
		openGraph: {
			title: seo.ogTitle,
			description: seo.ogDescription,
			url,
			type: 'website',
			images: [
				{
					url: '/og-image.png',
					width: 1200,
					height: 630,
					alt: 'WinWidget'
				}
			]
		},
		alternates: { canonical: url }
	}
}
