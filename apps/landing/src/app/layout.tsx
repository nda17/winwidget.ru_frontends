import Layout from '@/app/_ui/layout/Layout'
import { brandUnbounded } from '@/app/config/fonts'
import AppProviders from '@/app/providers/AppProviders'
import '@/app/styles/globals.scss'
import { EnumTokens } from '@/shared/api/token-names'
import { getHomePageContent } from '@/entities/home-page-content/server'
import { getSiteSettings } from '@/entities/site-settings/server'
import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import type { PropsWithChildren } from 'react'

export const metadata: Metadata = {
	metadataBase: new URL('https://winwidget.ru'),
	title: {
		default: 'WinWidget — продукты для привлечения и работы с клиентами',
		template: '%s — WinWidget'
	},
	description:
		'Widgets для привлечения заявок и WinCRM для работы с клиентами. Самостоятельные продукты экосистемы WinWidget с подключением по вашему выбору.',
	openGraph: {
		siteName: 'WinWidget',
		locale: 'ru_RU',
		type: 'website',
		images: [{ url: '/og-image.png', width: 1200, height: 630 }]
	}
}

const RootLayout = async ({ children }: PropsWithChildren<unknown>) => {
	const [siteSettings, homePageContent, cookieStore, headersList] =
		await Promise.all([
			getSiteSettings(),
			getHomePageContent(),
			cookies(),
			headers()
		])
	const isWidgetPreview =
		headersList.get('x-winwidget-widget-preview') === '1'
	const headHtml = homePageContent.head.enabled
		? homePageContent.head.html.trim()
		: ''
	const bodyHtml =
		!isWidgetPreview && homePageContent.body.enabled
			? homePageContent.body.html.trim()
			: ''
	const hasSessionHint = Boolean(
		cookieStore.get(EnumTokens.ACCESS_TOKEN)?.value ||
		cookieStore.get(EnumTokens.REFRESH_TOKEN)?.value
	)

	return (
		<html lang="ru" className={brandUnbounded.variable}>
			{headHtml && <head dangerouslySetInnerHTML={{ __html: headHtml }} />}
			<body>
				<AppProviders hasSessionHint={hasSessionHint}>
					<Layout
						siteSettings={siteSettings}
						footerContent={homePageContent.footer}
					>
						{children}
					</Layout>
				</AppProviders>
				{bodyHtml && (
					<div
						data-body-html
						style={{ display: 'contents' }}
						dangerouslySetInnerHTML={{ __html: bodyHtml }}
					/>
				)}
			</body>
		</html>
	)
}

export default RootLayout
