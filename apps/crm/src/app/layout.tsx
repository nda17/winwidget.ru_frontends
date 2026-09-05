import AppProviders from '@/app/providers/AppProviders'
import '@/app/styles/globals.scss'
import { PrelaunchScreen } from '@/screens/prelaunch'
import { getRuntimeConfig } from '@/shared/config/runtime'
import type { Metadata } from 'next'
import type { PropsWithChildren } from 'react'

export const metadata: Metadata = {
	metadataBase: new URL('https://crm.winwidget.ru'),
	title: {
		default: 'WinCRM',
		template: '%s — WinCRM'
	},
	description: 'CRM для управления обращениями, сделками и задачами.',
	robots: {
		index: false,
		follow: false,
		noarchive: true
	}
}

const RootLayout = ({ children }: PropsWithChildren) => {
	const { wincrmEnabled, mainAppOrigin } = getRuntimeConfig()

	return (
		<html lang="ru">
			<body>
				{wincrmEnabled ? (
					<AppProviders>{children}</AppProviders>
				) : (
					<PrelaunchScreen mainAppOrigin={mainAppOrigin} />
				)}
			</body>
		</html>
	)
}

export default RootLayout
