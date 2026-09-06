'use client'

import type { HomePageContent } from '@/entities/home-page-content'
import { DEFAULT_HOME_PAGE_CONTENT } from '@/entities/home-page-content/model/home-page-content.defaults'
import {
	marketingTextLimit,
	normalizeMarketingContent
} from '@/entities/home-page-content/model/product-marketing.defaults'
import { useId } from 'react'
import toast from 'react-hot-toast'
import styles from './HomeContentEditor.module.scss'

type PageKey = 'ecosystem' | 'crmProduct'

const LABELS: Record<string, string> = {
	seo: 'SEO страницы',
	hero: 'Первый экран',
	eyebrow: 'Надзаголовок',
	title: 'Заголовок',
	subtitle: 'Подзаголовок',
	products: 'Продукты',
	widgets: 'Виджеты WinWidget',
	crm: 'WinCRM',
	description: 'Описание',
	features: 'Возможности',
	buttonText: 'Текст кнопки',
	integration: 'Подключение продуктов',
	enabled: 'Показывать раздел',
	items: 'Карточки раздела',
	note: 'Пояснение',
	text: 'Текст',
	plans: 'Подписки',
	widgetsButtonText: 'Кнопка виджетов',
	crmButtonText: 'Кнопка WinCRM',
	faq: 'Вопросы и ответы',
	question: 'Вопрос',
	answer: 'Ответ',
	cta: 'Заключительный блок',
	workflow: 'Порядок работы',
	keywords: 'Ключевые слова',
	ogTitle: 'Open Graph — заголовок',
	ogDescription: 'Open Graph — описание'
}

const record = (value: unknown): Record<string, unknown> =>
	value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {}

// Both the field list and the shape of an added card come only from the
// trusted page template, never from arbitrary keys in stored JSON.
function EditorialField({
	value,
	template,
	fieldKey,
	id,
	onChange
}: {
	value: unknown
	template: unknown
	fieldKey: string
	id: string
	onChange: (value: unknown) => void
}) {
	const label = LABELS[fieldKey] ?? fieldKey
	if (typeof template === 'boolean') {
		return (
			<label className={styles.marketingToggle}>
				<input
					type="checkbox"
					checked={value === true}
					onChange={event => onChange(event.target.checked)}
				/>
				{label}
			</label>
		)
	}
	if (typeof template === 'string') {
		const maxLength = marketingTextLimit(fieldKey)
		return (
			<div className={styles.field}>
				<label htmlFor={id} className={styles.fieldLabel}>
					{label}
				</label>
				<textarea
					id={id}
					className={styles.textarea}
					value={typeof value === 'string' ? value : ''}
					maxLength={maxLength}
					rows={
						fieldKey.toLowerCase().includes('button') ||
						fieldKey === 'keywords'
							? 1
							: 3
					}
					onChange={event => onChange(event.target.value)}
				/>
			</div>
		)
	}
	if (Array.isArray(template)) {
		const items = Array.isArray(value) ? value : []
		return (
			<fieldset className={styles.marketingGroup}>
				<legend className={styles.fieldLabel}>{label}</legend>
				{items.map((item, index) => (
					<div key={index} className={styles.itemCard}>
						<EditorialField
							value={item}
							template={template[0]}
							fieldKey={fieldKey}
							id={`${id}-${index}`}
							onChange={next =>
								onChange(items.map((old, i) => (i === index ? next : old)))
							}
						/>
						<div className={styles.itemActions}>
							<button
								type="button"
								className={styles.smallBtn}
								disabled={index === 0}
								onClick={() => {
									const next = [...items]
									;[next[index - 1], next[index]] = [
										next[index],
										next[index - 1]
									]
									onChange(next)
									toast.success('Порядок изменён. Сохраните страницу.')
								}}
							>
								Выше
							</button>
							<button
								type="button"
								className={styles.dangerBtn}
								aria-label={`Удалить элемент ${index + 1}: ${label}`}
								onClick={() => {
									onChange(items.filter((_, i) => i !== index))
									toast.success('Элемент удалён из черновика.')
								}}
							>
								Удалить
							</button>
						</div>
					</div>
				))}
				<button
					type="button"
					className={styles.addBtn}
					disabled={items.length >= 50}
					onClick={() => {
						onChange([
							...items,
							typeof template[0] === 'string'
								? ''
								: Object.fromEntries(
										Object.keys(record(template[0])).map(key => [key, ''])
									)
						])
						toast.success('Элемент добавлен в черновик.')
					}}
				>
					Добавить элемент
				</button>
			</fieldset>
		)
	}
	return (
		<div className={styles.marketingFields}>
			{Object.entries(record(template)).map(([key, field]) => {
				const input = (
					<EditorialField
						key={key}
						value={record(value)[key]}
						template={field}
						fieldKey={key}
						id={`${id}-${key}`}
						onChange={next => onChange({ ...record(value), [key]: next })}
					/>
				)
				return key === 'widgets' || key === 'crm' ? (
					<fieldset className={styles.marketingGroup} key={key}>
						<legend className={styles.panelTitle}>{LABELS[key]}</legend>
						{input}
					</fieldset>
				) : (
					input
				)
			})}
		</div>
	)
}

export default function ProductContentFields<K extends PageKey>({
	area,
	value,
	onChange,
	mode = 'page'
}: {
	area: K
	value: HomePageContent[K]
	onChange: (value: HomePageContent[K]) => void
	mode?: 'page' | 'seo'
}) {
	const id = useId()
	const template = DEFAULT_HOME_PAGE_CONTENT[area]
	return (
		<>
			{Object.entries(template)
				.filter(([key]) =>
					mode === 'seo' ? key === 'seo' : key !== 'seo'
				)
				.map(([key, section]) => (
					<fieldset key={key} className={styles.panel}>
						<legend className={styles.panelTitle}>{LABELS[key]}</legend>
						<EditorialField
							value={record(value)[key]}
							template={section}
							fieldKey={key}
							id={`${id}-${key}`}
							onChange={next =>
								onChange(
									normalizeMarketingContent(
										{ ...value, [key]: next },
										template
									)
								)
							}
						/>
					</fieldset>
				))}
		</>
	)
}
