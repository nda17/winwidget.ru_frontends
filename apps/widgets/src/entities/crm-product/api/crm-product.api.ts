import { axiosInterceptorsRequest } from '@/shared/api'
import { CRM_RELEASE } from '@/shared/config/crm-release.config'
import {
	parseCrmCommercialPolicy,
	parseCrmProfileStatus
} from '../model/crm-product.contract'

async function getProductResource(path: string, signal?: AbortSignal) {
	if (!CRM_RELEASE.apiEnabled) throw new Error('WinCRM is not released')
	const { data } = await axiosInterceptorsRequest.get<unknown>(path, {
		timeout: 15_000,
		signal
	})
	return data
}

export const crmProductService = {
	async getPolicy(signal?: AbortSignal) {
		return parseCrmCommercialPolicy(
			await getProductResource('/billing-settings/crm', signal)
		)
	},
	async getProfileStatus(signal?: AbortSignal) {
		return parseCrmProfileStatus(
			await getProductResource('/crm/access/bootstrap', signal)
		)
	}
}
