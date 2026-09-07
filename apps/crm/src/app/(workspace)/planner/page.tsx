import type { Metadata } from 'next'
import { MyDayScreen } from '@/screens/my-day'

export const metadata: Metadata = { title: 'Планировщик' }
export default function PlannerPage() {
	return <MyDayScreen />
}
