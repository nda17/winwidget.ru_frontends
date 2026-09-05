import { redirect } from 'next/navigation'
import { getRuntimeConfig } from '@/shared/config/runtime'

const HomePage = () => {
	if (getRuntimeConfig().wincrmEnabled) redirect('/inbox')
	return null
}

export default HomePage
