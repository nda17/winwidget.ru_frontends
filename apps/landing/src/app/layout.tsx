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
		default: 'Winwidget — виджеты для увеличения конверсии',
		template: '%s — Winwidget'
	},
	description:
		'Колесо фортуны и другие виджеты для сайта. Собирайте контакты посетителей через игровую механику. Простая установка за 10 минут.',
	openGraph: {
		siteName: 'Winwidget',
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
