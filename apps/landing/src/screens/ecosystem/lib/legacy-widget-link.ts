const LEGACY_WIDGET_ANCHORS = new Set(['#tools', '#pricing', '#faq'])

export const legacyWidgetLink = (
	pathname: string,
	search: string,
	hash: string
): string | null => {
	if (pathname !== '/' || !LEGACY_WIDGET_ANCHORS.has(hash)) return null
	return `/products/widgets${search}${hash}`
}
