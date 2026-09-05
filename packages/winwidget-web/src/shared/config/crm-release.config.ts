// Frontend publication does not release the CRM backend or enable sales.
// Change only with the compatible Gateway, Identity, Billing and CRM rollout.
export const CRM_RELEASE = {
	apiEnabled: false,
	appUrl: 'https://crm.winwidget.ru',
	unavailableLabel: 'Скоро'
} as const
