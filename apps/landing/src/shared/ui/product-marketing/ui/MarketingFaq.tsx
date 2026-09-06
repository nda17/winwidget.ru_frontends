'use client'

import toast from 'react-hot-toast'
import styles from './ProductMarketing.module.scss'

interface MarketingFaqProps {
	title: string
	items: { question: string; answer: string }[]
}

export const MarketingFaq = ({ title, items }: MarketingFaqProps) => (
	<div className={styles.faq}>
		<h2 className={styles.sectionTitle}>{title}</h2>
		<div className={styles.faqList}>
			{items.map((item, index) => (
				<details
					key={`${item.question}-${index}`}
					className={styles.faqItem}
					onToggle={event => {
						toast(
							event.currentTarget.open ? 'Ответ открыт' : 'Ответ скрыт',
							{
								id: 'product-faq'
							}
						)
					}}
				>
					<summary>
						<span>{item.question}</span>
						<span className={styles.faqArrow} aria-hidden="true">
							+
						</span>
					</summary>
					<p>{item.answer}</p>
				</details>
			))}
		</div>
	</div>
)
