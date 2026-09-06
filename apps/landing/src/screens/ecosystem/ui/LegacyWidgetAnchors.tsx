'use client'

import { useEffect } from 'react'
import { legacyWidgetLink } from '../lib/legacy-widget-link'

export const LegacyWidgetAnchors = () => {
	useEffect(() => {
		const preserveWidgetAnchor = () => {
			const { pathname, search, hash } = window.location
			const target = legacyWidgetLink(pathname, search, hash)
			if (target) window.location.replace(target)
		}
		preserveWidgetAnchor()
		window.addEventListener('hashchange', preserveWidgetAnchor)
		return () =>
			window.removeEventListener('hashchange', preserveWidgetAnchor)
	}, [])

	return null
}
