class PublicPages {
	HOME = '/'
	WIDGETS_PRODUCT = '/products/widgets'
	CRM_PRODUCT = '/products/crm'
	PLANS = '/#plans'
	HELP = '/#help'
	LOGIN = '/login'
	REGISTER = '/register'
	RESTORE_PASSWORD = '/restore-password'
	USER_PROFILE = '/cabinet'
	PERSONAL_POLICY = '/legal-documentation/personal-policy'
	CONSENT_PROCESSING = '/legal-documentation/consent-processing'
	COOKIE_NOTICE = '/legal-documentation/cookie-notice'
	OFERTA = '/legal-documentation/oferta'
	SOCIALS_LINK_VK = 'https://vk.ru'
	SOCIALS_LINK_TG = 'https://t.me/ybs_one'
	CABINET = '/cabinet'
	PAYMENT = '/payment'
}

export const PUBLIC_PAGES = new PublicPages()

// UI navigation only. API authorization and server-side route guards remain authoritative.
export const isSessionProtectedPath = (pathname: string) =>
	[PUBLIC_PAGES.USER_PROFILE, '/admin'].some(
		prefix => pathname === prefix || pathname.startsWith(`${prefix}/`)
	)

export const isMarketingPage = (pathname: string) =>
	[
		PUBLIC_PAGES.HOME,
		PUBLIC_PAGES.WIDGETS_PRODUCT,
		PUBLIC_PAGES.CRM_PRODUCT
	].includes(pathname)
