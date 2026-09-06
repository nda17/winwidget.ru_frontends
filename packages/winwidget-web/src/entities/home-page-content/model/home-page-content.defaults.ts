import type {
	HomePageContent,
	HomePageIntegrationIconKey,
	HomePagePricingPlan,
	HomePageSitemapChangeFrequency,
	HomePageToolItem,
	HomePageToolPreviewType
} from '@/entities/home-page-content/model/home-page-content.types'
import {
	DEFAULT_CRM_PRODUCT_CONTENT,
	DEFAULT_ECOSYSTEM_CONTENT,
	normalizeMarketingContent
} from './product-marketing.defaults'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeDemoWidgetsContent = (
	value: unknown,
	fallback: HomePageContent['demoWidgets']
): HomePageContent['demoWidgets'] => {
	const demoWidgets = isRecord(value) ? value : {}
	const bubbleTexts = isRecord(demoWidgets.bubbleTexts)
		? demoWidgets.bubbleTexts
		: {}

	const normalizeBubbleText = (
		key: keyof HomePageContent['demoWidgets']['bubbleTexts']
	) =>
		typeof bubbleTexts[key] === 'string'
			? bubbleTexts[key]
			: fallback.bubbleTexts[key]

	return {
		enabled:
			typeof demoWidgets.enabled === 'boolean'
				? demoWidgets.enabled
				: fallback.enabled,
		bubbleTexts: {
			wheel: normalizeBubbleText('wheel'),
			quiz: normalizeBubbleText('quiz'),
			callback: normalizeBubbleText('callback'),
			countdown: normalizeBubbleText('countdown'),
			aiConsultant: normalizeBubbleText('aiConsultant'),
			stopOffer: normalizeBubbleText('stopOffer'),
			calculator: normalizeBubbleText('calculator')
		}
	}
}

const mergeObject = <T extends object>(
	fallback: T,
	value: unknown
): T => ({
	...clone(fallback),
	...(isRecord(value) ? value : {})
})

const mergeSimpleArray = <T extends object>(
	value: unknown,
	fallback: T[]
): T[] => {
	if (!Array.isArray(value)) return clone(fallback)

	return value.map((item, index) => ({
		...clone(fallback[index] ?? fallback[fallback.length - 1]),
		...(isRecord(item) ? item : {})
	})) as T[]
}

const TOOL_PREVIEW_TYPES: HomePageToolPreviewType[] = [
	'wheel',
	'quiz',
	'callback',
	'timer',
	'aiConsultant',
	'stopOffer',
	'calculator',
	'none'
]

const normalizeToolPreviewType = (
	value: unknown,
	fallback: HomePageToolPreviewType
): HomePageToolPreviewType =>
	TOOL_PREVIEW_TYPES.includes(value as HomePageToolPreviewType)
		? (value as HomePageToolPreviewType)
		: fallback

const mergeToolItems = (
	value: unknown,
	fallback: HomePageToolItem[]
): HomePageToolItem[] => {
	if (!Array.isArray(value)) return clone(fallback)

	return value.map((item, index) => {
		const base = clone(fallback[index] ?? fallback[fallback.length - 1])
		const merged = {
			...base,
			...(isRecord(item) ? item : {})
		}

		return {
			...merged,
			previewType: normalizeToolPreviewType(
				isRecord(item) ? item.previewType : undefined,
				base.previewType
			)
		}
	})
}

const mergeStringArray = (
	value: unknown,
	fallback: string[]
): string[] => {
	if (!Array.isArray(value)) return clone(fallback)

	return value.map(item => String(item))
}

const mergePaymentContent = (
	value: unknown,
	fallback: HomePageContent['payment']
): HomePageContent['payment'] => {
	if (!isRecord(value)) return clone(fallback)

	return {
		seoTitle:
			typeof value.seoTitle === 'string'
				? value.seoTitle
				: fallback.seoTitle,
		seoDescription:
			typeof value.seoDescription === 'string'
				? value.seoDescription
				: fallback.seoDescription
	}
}

const mergePricingPlans = (
	value: unknown,
	fallback: HomePagePricingPlan[]
): HomePagePricingPlan[] => {
	if (!Array.isArray(value)) return clone(fallback)

	return value.map((item, index) => {
		const base = clone(fallback[index] ?? fallback[fallback.length - 1])
		if (!isRecord(item)) return base

		return {
			...base,
			...item,
			features: Array.isArray(item.features)
				? item.features.map(feature => String(feature))
				: base.features,
			monthly: {
				...base.monthly,
				...(isRecord(item.monthly) ? item.monthly : {})
			},
			yearly: {
				...base.yearly,
				...(isRecord(item.yearly) ? item.yearly : {})
			}
		}
	})
}

const normalizeIconKey = (
	value: unknown,
	fallback: HomePageIntegrationIconKey
): HomePageIntegrationIconKey => {
	const allowed: HomePageIntegrationIconKey[] = [
		'email',
		'telegram',
		'webhook',
		'bitrix',
		'amocrm',
		'metrika',
		'vk',
		'roistat'
	]

	return allowed.includes(value as HomePageIntegrationIconKey)
		? (value as HomePageIntegrationIconKey)
		: fallback
}

const SITEMAP_CHANGE_FREQUENCIES: HomePageSitemapChangeFrequency[] = [
	'always',
	'hourly',
	'daily',
	'weekly',
	'monthly',
	'yearly',
	'never'
]

const normalizeSitemapChangeFrequency = (
	value: unknown,
	fallback: HomePageSitemapChangeFrequency
): HomePageSitemapChangeFrequency =>
	SITEMAP_CHANGE_FREQUENCIES.includes(
		value as HomePageSitemapChangeFrequency
	)
		? (value as HomePageSitemapChangeFrequency)
		: fallback

const normalizePath = (value: unknown, fallback: string): string => {
	const candidate = typeof value === 'string' ? value.trim() : ''
	if (!candidate) return fallback

	if (
		candidate.startsWith('http://') ||
		candidate.startsWith('https://')
	) {
		try {
			return new URL(candidate).pathname || '/'
		} catch {
			return fallback
		}
	}

	return candidate.startsWith('/') ? candidate : `/${candidate}`
}

const normalizeBaseUrl = (value: unknown, fallback: string): string => {
	const candidate = typeof value === 'string' ? value.trim() : ''
	if (!candidate) return fallback

	try {
		return new URL(candidate).origin
	} catch {
		return fallback
	}
}

const normalizePriority = (value: unknown, fallback: number): number => {
	const numeric = Number(value)
	if (!Number.isFinite(numeric)) return fallback

	return Math.min(1, Math.max(0, numeric))
}

const mergeRobotsDisallow = (
	value: unknown,
	fallback: string[]
): string[] => {
	if (!Array.isArray(value)) return clone(fallback)

	const lines = value.map(item => normalizePath(item, '')).filter(Boolean)

	return Array.from(new Set(lines))
}

const mergeSitemapItems = (
	value: unknown,
	fallback: HomePageContent['technicalSeo']['sitemapItems']
): HomePageContent['technicalSeo']['sitemapItems'] => {
	if (!Array.isArray(value)) return clone(fallback)

	return value.map((item, index) => {
		const base = clone(fallback[index] ?? fallback[fallback.length - 1])
		if (!isRecord(item)) return base

		return {
			...base,
			...item,
			path: normalizePath(item.path, base.path),
			changeFrequency: normalizeSitemapChangeFrequency(
				item.changeFrequency,
				base.changeFrequency
			),
			priority: normalizePriority(item.priority, base.priority),
			enabled:
				typeof item.enabled === 'boolean' ? item.enabled : base.enabled
		}
	})
}

export const DEFAULT_HOME_PAGE_FOOTER_CONTENT: HomePageContent['footer'] =
	{
		aboutTitle: 'О нас:',
		infoLines: ['ООО «ЮБС»', 'ИНН: 2700019628', 'ОГРН: 1232700016460'],
		email: 'info@winwidget.ru',
		ybsUrl: 'https://ybs.one',
		vkUrl: 'https://vk.ru',
		telegramUrl: 'https://t.me/winwidget_support_bot',
		vkAriaLabel: 'Winwidget во ВКонтакте',
		telegramAriaLabel: 'Winwidget в Telegram',
		legalDisclaimer:
			'Согласно ст. 437 ГК РФ, информация на сайте не является публичной офертой.'
	}

export const DEFAULT_HOME_PAGE_BODY_CONTENT: HomePageContent['body'] = {
	enabled: false,
	html: ''
}

export const DEFAULT_HOME_PAGE_HEAD_CONTENT: HomePageContent['head'] = {
	enabled: false,
	html: ''
}

export const DEFAULT_HOME_PAGE_TECHNICAL_SEO_CONTENT: HomePageContent['technicalSeo'] =
	{
		baseUrl: 'https://winwidget.ru',
		robotsDisallow: [
			'/admin/',
			'/cabinet/',
			'/wheels/',
			'/quizzes/',
			'/callbacks/',
			'/ai-consultants/',
			'/timers/',
			'/stop-offers/',
			'/calculators/',
			'/page-wheel/',
			'/page-quiz/',
			'/page-callback/',
			'/page-ai-consultant/',
			'/page-timer/',
			'/page-stop-offer/',
			'/page-calculator/',
			'/payment/',
			'/logout/',
			'/login/',
			'/register/',
			'/restore-password/',
			'/social-auth/'
		],
		sitemapItems: [
			{
				path: '/',
				changeFrequency: 'weekly',
				priority: 1,
				enabled: true
			},
			{
				path: '/legal-documentation/personal-policy',
				changeFrequency: 'yearly',
				priority: 0.3,
				enabled: true
			},
			{
				path: '/legal-documentation/consent-processing',
				changeFrequency: 'yearly',
				priority: 0.3,
				enabled: true
			},
			{
				path: '/legal-documentation/cookie-notice',
				changeFrequency: 'yearly',
				priority: 0.3,
				enabled: true
			},
			{
				path: '/legal-documentation/oferta',
				changeFrequency: 'yearly',
				priority: 0.3,
				enabled: true
			}
		]
	}

export const DEFAULT_HOME_PAGE_CONTENT: HomePageContent = {
	ecosystem: DEFAULT_ECOSYSTEM_CONTENT,
	crmProduct: DEFAULT_CRM_PRODUCT_CONTENT,
	seo: {
		title: 'Winwidget — AI-консультант и виджеты для сайта',
		description:
			'AI-консультант Winwidget отвечает клиентам 24/7 по вашей текстовой инструкции. Колесо фортуны, квиз, заказ звонка и другие виджеты помогают расти конверсии.',
		keywords: [
			'ai консультант для сайта',
			'ai чат для сайта',
			'виртуальный консультант',
			'виджет колесо фортуны',
			'виджет для сайта',
			'увеличение конверсии',
			'winwidget'
		],
		ogTitle: 'Winwidget — AI-консультант для вашего сайта',
		ogDescription:
			'Добавьте текстовую инструкцию о компании, товарах и ценах — AI-оператор будет отвечать клиентам круглосуточно.'
	},
	technicalSeo: DEFAULT_HOME_PAGE_TECHNICAL_SEO_CONTENT,
	demoWidgets: {
		enabled: true,
		bubbleTexts: {
			wheel: 'Испытайте удачу!',
			quiz: 'Поможем сделать выбор!',
			callback: 'Перезвоним вам за 5 минут',
			countdown: 'Супер-акция!',
			aiConsultant: 'Задайте вопрос AI-оператору',
			stopOffer: 'Остановите клиента при уходе!',
			calculator: 'Рассчитайте стоимость!'
		}
	},
	hero: {
		titleBeforeAccent: 'Увеличение конверсии\nсайта до',
		accentText: '30%',
		titleAfterAccent: 'с помощью умных виджетов',
		subtitle: 'Простая интеграция, заметный результат.',
		primaryButtonText: 'Попробовать бесплатно 7 дней',
		faqButtonLabel: 'Прокрутить к вопросам и ответам',
		benefits: [
			{ text: '7 дней бесплатно' },
			{ text: 'Оплата через ЮKassa' },
			{ text: 'Установка за 10 минут' }
		]
	},
	analysis: {
		enabled: true,
		title:
			'98% посетителей уходят с вашего сайта навсегда, не оставив контактов',
		subtitle:
			'Вы платите за рекламу, SEO и контент, но клиенты молча закрывают вкладку. Мы поможем их «зацепить», когда они:',
		cards: [
			{
				text: 'Собираются уйти'
			},
			{
				text: 'Долго листают страницу'
			},
			{
				text: 'Сравнивают с конкурентами'
			},
			{
				text: 'Хотят быстрой связи'
			}
		]
	},
	integrations: {
		enabled: true,
		title: 'Готовые интеграции для вашего бизнеса',
		items: [
			{
				title: 'Email',
				tag: 'Уведомления',
				description:
					'Мгновенное письмо с именем, призом и страницей при каждой заявке',
				iconKey: 'email'
			},
			{
				title: 'Telegram',
				tag: 'Мессенджер',
				description:
					'Уведомления прямо в чат — быстрее почты, всегда под рукой',
				iconKey: 'telegram'
			},
			{
				title: 'Webhook',
				tag: 'Интеграция',
				description:
					'POST-запрос с данными лида — подключите Make, Zapier или n8n',
				iconKey: 'webhook'
			},
			{
				title: 'Битрикс24',
				tag: 'CRM',
				description:
					'Лид с именем, телефоном и страницей создаётся автоматически',
				iconKey: 'bitrix'
			},
			{
				title: 'amoCRM',
				tag: 'CRM',
				description:
					'Новая сделка и контакт без ручного ввода при каждой заявке',
				iconKey: 'amocrm'
			},
			{
				title: 'Яндекс Метрика',
				tag: 'Аналитика',
				description:
					'Цели ip3_open и ip3_send — воронка от клика до заявки у вас в счётчике',
				iconKey: 'metrika'
			},
			{
				title: 'VK Ретаргетинг',
				tag: 'Реклама',
				description:
					'Аудитория для ретаргетинга ВКонтакте — показывайте рекламу тем, кто крутил',
				iconKey: 'vk'
			},
			{
				title: 'Roistat',
				tag: 'Аналитика',
				description:
					'Видите ROI каждого канала — события передаются без дополнительных настроек',
				iconKey: 'roistat'
			}
		]
	},
	tools: {
		enabled: true,
		title: 'AI-консультант и виджеты для вашего сайта',
		ctaText: 'Попробовать бесплатно 7 дней',
		items: [
			{
				title: 'Колесо Фортуны',
				description: 'Дарите скидки\nи бонусы за телефон и/или email',
				comingSoon: false,
				previewType: 'wheel'
			},
			{
				title: 'Квиз-опросы',
				description:
					'Сегментируйте клиентов\nи показывайте точный результат',
				comingSoon: false,
				previewType: 'quiz'
			},
			{
				title: 'Заказ звонка',
				description: 'Связывайтесь с клиентом\nпо его просьбе перезвонить',
				comingSoon: false,
				previewType: 'callback'
			},
			{
				title: 'Обратный отсчёт',
				description: 'Создавайте ощущение\nсрочности у покупателя',
				comingSoon: false,
				previewType: 'timer'
			},
			{
				title: 'AI-консультант',
				description:
					'Отвечает на вопросы 24/7 по вашей текстовой инструкции.\nЕсли в промпте нет нужной информации, честно сообщает об этом.',
				comingSoon: false,
				previewType: 'aiConsultant'
			},
			{
				title: 'Стоп-оффер',
				description:
					'Появляется, когда пользователь собирается уйти: “Заберите скидку 10%”.\nХорошо возвращает часть потерянного трафика.\n',
				comingSoon: false,
				previewType: 'stopOffer'
			},
			{
				title: 'Калькулятор стоимости',
				description:
					'“Рассчитать цену” с несколькими параметрами и сбором контакта перед результатом или после.\nОтлично для услуг, ремонта, доставки, мебели, производства.\n',
				comingSoon: false,
				previewType: 'calculator'
			}
		]
	},
	audiences: {
		enabled: true,
		title: 'Подходит бизнесам, где важна каждая заявка',
		subtitle:
			'Winwidget помогает не терять посетителей в разных нишах: от интернет-магазинов до услуг с длинным циклом выбора.',
		items: [
			{
				title: 'E-commerce',
				text: 'Скидки, подарки и стоп-офферы помогают вернуть посетителя к покупке.'
			},
			{
				title: 'Услуги и консультации',
				text: 'Квиз или заказ звонка превращает интерес в конкретную заявку.'
			},
			{
				title: 'Бьюти и медицина',
				text: 'Акции, запись и быстрый контакт помогают заполнить расписание.'
			},
			{
				title: 'Обучение и мероприятия',
				text: 'Сбор заявок, сегментация и напоминания помогают прогреть аудиторию.'
			}
		]
	},
	caseStudies: {
		enabled: true,
		title: 'Как это работает на практике',
		subtitle:
			'Несколько понятных сценариев, где виджеты закрывают реальные задачи бизнеса.',
		items: [
			{
				title: 'Интернет-магазин',
				text: 'Посетитель собирается уйти без покупки. Стоп-оффер показывает персональную скидку и забирает контакт.',
				result: 'Часть потерянного трафика возвращается в воронку продаж.'
			},
			{
				title: 'Сайт услуг',
				text: 'Квиз задаёт 3-5 вопросов, помогает выбрать услугу и передаёт менеджеру уже тёплую заявку.',
				result:
					'Менеджер видит контекст обращения, а не просто номер телефона.'
			},
			{
				title: 'Лендинг акции',
				text: 'Обратный отсчёт и колесо фортуны усиливают срочность и дают понятный повод оставить контакт.',
				result: 'Посетителю проще сделать первый шаг прямо сейчас.'
			}
		]
	},
	leadFlow: {
		enabled: true,
		title: 'Что происходит после заявки',
		subtitle:
			'Виджет не просто собирает контакт: заявка сразу попадает туда, где её удобно обработать.',
		items: [
			{
				title: 'Посетитель оставляет контакт',
				text: 'Телефон, email, выбранный бонус, результат квиза или страница сохраняются автоматически.'
			},
			{
				title: 'Заявка приходит в нужный канал',
				text: 'Кабинет, Email, Telegram, CRM или webhook получают данные без ручного копирования.'
			},
			{
				title: 'Менеджер быстро связывается',
				text: 'В заявке уже есть контекст: с какой страницы пришёл клиент и что его заинтересовало.'
			},
			{
				title: 'Аналитика показывает результат',
				text: 'Вы видите, какие сценарии и бонусы собирают больше заявок.'
			}
		]
	},
	whyWidgets: {
		enabled: true,
		title: 'Почему это сильнее обычной формы',
		subtitle:
			'Статичная форма ждёт, пока посетитель сам решится. Виджет ловит момент интереса и помогает сделать первый шаг.',
		formTitle: 'Обычная форма',
		widgetTitle: 'Умный виджет',
		formItems: [
			{ text: 'Пассивно размещена на странице' },
			{ text: 'Не реагирует на поведение посетителя' },
			{ text: 'Даёт мало поводов оставить контакт' }
		],
		widgetItems: [
			{ text: 'Появляется в нужный момент' },
			{ text: 'Даёт бонус, срочность или быстрый сценарий выбора' },
			{ text: 'Сразу передаёт заявку в кабинет и интеграции' }
		]
	},
	steps: {
		enabled: true,
		title: 'Установка проще, чем сварить кофе',
		resultText: 'Ловите\nгорячие\nлиды!',
		items: [
			{
				text: 'Настройте дизайн и логику виджета'
			},
			{
				text: 'Скопируйте одну строчку кода'
			},
			{
				text: 'Вставьте в код своего сайта'
			}
		]
	},
	customization: {
		enabled: true,
		title: 'Полная кастомизация под ваш бренд',
		subtitle:
			'Настраивайте цвета, тексты, бонусы и внешний вид виджета под стиль вашей компании',
		cards: [
			{
				title: 'Цвета и стиль',
				text: 'Подберите идеальные цвета под айдентику вашего бренда'
			},
			{
				title: 'Тексты и кнопки',
				text: 'Изменяйте заголовки, подписи и тексты под свой бренд'
			},
			{
				title: 'Бонусы и логика',
				text: 'Настраивайте бонусы, секторы и вероятность выигрыша'
			},
			{
				title: 'Live превью',
				text: 'Настраивайте виджеты реактивно'
			}
		],
		features: [
			{
				text: 'Свой бренд'
			},
			{
				text: 'Гибкие настройки'
			},
			{
				text: 'Единый стиль сайта'
			}
		],
		bottomText: 'Виджет выглядит так, как нужно именно вашему бизнесу'
	},
	dashboardPreview: {
		enabled: true,
		title: 'В личном кабинете видно всё важное',
		subtitle:
			'После регистрации вы управляете виджетами, заявками, интеграциями и настройками из одного места.',
		cards: [
			{
				title: 'Заявки',
				text: 'Телефоны, email, бонусы, страницы и даты обращений хранятся в кабинете.'
			},
			{
				title: 'Настройки',
				text: 'Цвета, тексты, логика показа, интеграции и домен установки меняются без разработчика.'
			},
			{
				title: 'Аналитика',
				text: 'Смотрите, какие сценарии, результаты и бонусы приводят больше лидов.'
			}
		],
		metrics: [
			{ title: '5', text: 'видов виджетов уже доступны' },
			{ title: '10 минут', text: 'до первой установки на сайт' },
			{ title: '24/7', text: 'сбор заявок без участия менеджера' }
		]
	},
	directLink: {
		enabled: true,
		title: 'Можно использовать даже без сайта',
		subtitle:
			'У каждого виджета есть публичная ссылка. Её можно отправлять клиентам напрямую или размещать там, где сайта пока нет.',
		items: [
			{
				title: 'Соцсети и мессенджеры',
				text: 'Отправляйте ссылку в Telegram, VK, WhatsApp или рекламных сообщениях.'
			},
			{
				title: 'QR-код в офлайне',
				text: 'Печатайте QR на стойке, флаере, меню или визитке.'
			},
			{
				title: 'Быстрые акции',
				text: 'Запускайте розыгрыш или сбор заявок без отдельной посадочной страницы.'
			}
		]
	},
	security: {
		enabled: true,
		title: 'Доверие, безопасность и контроль',
		subtitle:
			'Winwidget сделан как коммерческий инструмент: с хранением заявок, ограничениями подписки и защитой установленного виджета.',
		items: [
			{
				title: 'Данные заявок сохраняются',
				text: 'Контакты и история заявок остаются в личном кабинете.'
			},
			{
				title: 'Автоматическая активация',
				text: 'Подписка активируется автоматически после оплаты.'
			},
			{
				title: 'Ограничение по домену',
				text: 'Виджет привязывается к домену установки, чтобы код не использовали на чужих сайтах.'
			},
			{
				title: 'Антидубли и ограничения',
				text: 'Настройки помогают снижать повторные и некачественные заявки.'
			}
		]
	},
	subscriptionBundle: {
		enabled: true,
		title: 'Одна подписка — все решения сразу',
		subtitle:
			'Подключили winwidget — получили виджеты,\nинтеграции и сбор заявок в одном сервисе.',
		cardTitle:
			'Оплатили подписку — получили полный набор инструментов для роста конверсии',
		items: [
			{
				text: 'Виджеты'
			},
			{
				text: 'Интеграции'
			},
			{
				text: 'Заявки'
			},
			{
				text: 'Аналитика'
			}
		]
	},
	tariffComparison: {
		enabled: true,
		title: 'Сравните тарифы по ключевым возможностям',
		subtitle:
			'Карточки тарифов показывают главное, а эта таблица помогает быстро понять разницу перед оплатой.',
		rows: [
			{
				feature: 'Количество виджетов',
				easy: '1 виджет',
				hard: '10 любых виджетов'
			},
			{
				feature: 'Лимит заявок',
				easy: '100 заявок в месяц',
				hard: 'Безлимитные заявки'
			},
			{
				feature: 'Интеграции',
				easy: 'Email, Telegram, CRM, Метрика, webhook',
				hard: 'Все интеграции Easy'
			},
			{
				feature: 'Аналитика и выгрузка',
				easy: 'Базовое хранение заявок',
				hard: 'Аналитика, Excel, PDF, CSV'
			},
			{
				feature: 'Брендинг виджета',
				easy: 'Ссылка на Winwidget',
				hard: 'Можно скрыть брендинг'
			}
		]
	},
	pricing: {
		enabled: true,
		title: 'Выберите удобный тариф',
		monthlyToggleText: 'Ежемесячно',
		yearlyToggleText: 'За год',
		discountText: '−60%',
		buttonText: 'Попробовать',
		plans: [
			{
				key: 'TRIAL',
				badge: '',
				title: 'Тест-драйв',
				subtitle: '1 виджет / 7 дней',
				features: [
					'1 виджет',
					'До 10 заявок',
					'Тестовый период - 7 дней',
					'Демонстрация работы всего функционала, доступного на платных тарифах'
				],
				monthly: {
					price: 'Бесплатно',
					priceNote: ''
				},
				yearly: {
					price: 'Бесплатно',
					priceNote: ''
				},
				star: false,
				popular: false
			},
			{
				key: 'EASY',
				badge: 'Выбор клиентов',
				title: 'Easy',
				subtitle: '1 виджет',
				features: [
					'100 заявок в месяц',
					'Хранение всех заявок в личном кабинете',
					'Email уведомления / Telegram',
					'Установка виджетов на сайт, открытие по прямой ссылке, QR-коду',
					'Интеграции с amoCRM, Bitrix24, Яндекс Метрика, VK Ретаргетинг, Roistat, по Webhook'
				],
				monthly: {
					price: '990 ₽',
					priceNote: 'в месяц'
				},
				yearly: {
					price: '390 ₽',
					priceNote: 'в месяц',
					yearlyTotal: '4 680 ₽/год'
				},
				star: true,
				popular: true
			},
			{
				key: 'HARD',
				badge: '',
				title: 'Hard',
				subtitle: '10 любых виджетов',
				features: [
					'Безлимитные заявки',
					'Хранение всех заявок в личном кабинете',
					'Установка виджетов на сайт, открытие по прямой ссылке, QR-коду',
					'Email уведомления / Telegram',
					'Аналитика бонусов',
					'Своя картинка кнопки открытия виджета',
					'Отключена рекламная ссылка на winwidget.ru в установленном виджете',
					'Интеграции с amoCRM, Bitrix24, Яндекс Метрика, VK Ретаргетинг, Roistat, по Webhook',
					'Выгрузка заявок в Exсel, PDF, CSV'
				],
				monthly: {
					price: '1 690 ₽',
					priceNote: 'в месяц'
				},
				yearly: {
					price: '790 ₽',
					priceNote: 'в месяц',
					yearlyTotal: '9 480 ₽/год'
				},
				star: false,
				popular: false
			}
		]
	},
	microCta: {
		enabled: true,
		afterIntegrationsText: 'Хотите получать заявки сразу в удобный канал?',
		afterIntegrationsButtonText: 'Создать первый виджет',
		afterStepsText:
			'Готовы проверить виджет на своём сайте или по прямой ссылке?',
		afterStepsButtonText: 'Попробовать бесплатно'
	},
	seoText: {
		enabled: true,
		title: 'AI-консультант и виджеты для роста конверсии',
		text: 'Winwidget объединяет AI-консультанта и интерактивные виджеты для сайта. AI-оператор отвечает на вопросы о товарах, ценах и условиях по текстовой инструкции владельца виджета. Он не загружает файлы, не обходит сайт и не использует отдельную базу знаний: если данных в промпте нет, он честно сообщает об этом. Колесо фортуны, квиз, заказ звонка, таймер, стоп-оффер и калькулятор дополняют чат и помогают вовлекать посетителей без сложной разработки.'
	},
	payment: {
		seoTitle: 'Тарифы и оплата',
		seoDescription:
			'Тарифы Winwidget и оплата подписки через ЮKassa. Виджеты для увеличения конверсии сайта.'
	},
	faq: {
		enabled: true,
		title: 'Часто задаваемые вопросы',
		items: [
			{
				question: 'Что такое AI-консультант?',
				answerHtml:
					'Это чат на сайте, в котором AI-оператор отвечает на вопросы посетителей. Имя оператора, приветствие, текстовую инструкцию и внешний вид задаёт владелец виджета. В интерфейсе всегда видно, что это AI, а не реальный сотрудник.'
			},
			{
				question: 'Откуда AI-консультант берёт ответы?',
				answerHtml:
					'Из текстового промпта, который вы задаёте в настройках. Туда можно добавить сведения о компании, товарах, ценах, доставке и других условиях. Загрузки PDF и Word, обхода сайта и отдельной базы знаний в текущей версии нет.'
			},
			{
				question: 'Что будет, если в промпте нет нужной информации?',
				answerHtml:
					'Сервис требует подтверждать ответ фрагментом вашей инструкции. Если подтверждения нет, AI-оператор сообщает, что данных недостаточно. Перед публикацией проверьте важные цены и условия в тестовом чате.'
			},
			{
				question: 'Можно ли спрашивать AI-оператора на посторонние темы?',
				answerHtml:
					'Спросить можно, но AI-консультант ограничивает разговор темой сайта и бизнеса. На просьбы, не относящиеся к указанной информации, он вежливо предлагает задать вопрос по теме.'
			},
			{
				question: 'Можно ли настроить имя и внешний вид AI-оператора?',
				answerHtml:
					'Да. По умолчанию оператора зовут Alex, но имя и приветствие можно изменить. Также настраиваются основной цвет, оформление, положение слева или справа и время бездействия. Рядом с именем всегда остаётся метка «AI-оператор».'
			},
			{
				question: 'Как установить AI-консультанта на сайт?',
				answerHtml:
					'Создайте виджет в личном кабинете, заполните промпт, проверьте ответы в тестовом чате и опубликуйте настройки. Затем скопируйте сгенерированный код и вставьте его перед закрывающим тегом &lt;/body&gt; — AI-консультант появится автоматически.'
			},
			{
				question: 'Могу ли я оплатить с расчётного счёта ИП или ООО?',
				answerHtml:
					'Да, мы выставляем счета для юридических лиц и ИП. Напишите нам на <a href="mailto:info@winwidget.ru">info@winwidget.ru</a> или в <a href="https://t.me/winwidget_support_bot" target="_blank" rel="noopener noreferrer">Telegram</a> для выставления счёта.'
			},
			{
				question:
					'Если у нас закончилась подписка и мы не оплатили вовремя, сохранятся ли наши заявки и настройки нашего виджета?',
				answerHtml:
					'Да, все заявки и настройки сохраняются. После истечения подписки виджет на сайте перестаёт отображаться, но все данные в личном кабинете остаются нетронутыми. После оплаты виджет возобновит работу автоматически.'
			},
			{
				question: 'Как быстро я смогу пользоваться виджетом после оплаты?',
				answerHtml:
					'Мгновенно. Как только оплата подтверждена, подписка активируется автоматически и виджет начинает работать на вашем сайте.'
			},
			{
				question: 'Как подключить уведомления на Email?',
				answerHtml:
					'В настройках виджета перейдите во вкладку «Интеграции» и введите адрес электронной почты. После каждой новой заявки вы будете получать письмо с именем, телефоном, email посетителя, выигранным призом и страницей, на которой он крутил колесо.'
			},
			{
				question: 'Как подключить уведомления в Telegram?',
				answerHtml:
					'Откройте Telegram-бота <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer">@userinfobot</a> и нажмите «Старт» — бот пришлёт вам информацию о вашем профиле. Скопируйте и вставьте ID профиля в поле «Telegram Chat ID» во вкладке «Интеграции». \nДалее перейдите в чат с нашим инфо-ботом <a href="https://t.me/winwidgetBot" target="_blank" rel="noopener noreferrer">@winwidget_info_bot</a> и нажмите «Старт».\nПосле этого Инфо-бот будет моментально пересылать вам каждую новую заявку в личные сообщения либо группу Telegram. Чтобы бот пересылал заявки в вашу группу, он должен быть участником этой группы.'
			},
			{
				question: 'Как интегрировать виджет с Битрикс24?',
				answerHtml:
					'<b>1.</b> В Битрикс24 перейдите в <b>Приложения → Вебхуки → Входящий вебхук</b>.<br><b>2.</b> Нажмите <b>«Добавить вебхук»</b>.<br><b>3.</b> В разделе <b>«Права»</b> включите <b>CRM</b> (crm).<br><b>4.</b> Нажмите <b>«Сохранить»</b>.<br><b>5.</b> Скопируйте <b>«Пример URL для вызова REST»</b> — ссылка вида <code>https://домен.bitrix24.ru/rest/1/токен/</code>.<br><b>6.</b> Вставьте её в поле <b>«Битрикс24 Webhook URL»</b> в настройках виджета и сохраните.<br><br>При каждой новой заявке в Битрикс24 будет автоматически создаваться <b>лид</b> с именем, телефоном, email, названием приза и ссылкой на страницу.'
			},
			{
				question: 'Как подключить amoCRM?',
				answerHtml:
					'<b>1.</b> Войдите в amoCRM → Настройки → Интеграции → вкладка <b>API</b>.<br><b>2.</b> Нажмите <b>«Показать ключи»</b> и скопируйте <b>Долгосрочный токен</b>.<br><b>3.</b> Скопируйте домен вашего аккаунта — вида <code>mycompany.amocrm.ru</code>.<br><b>4.</b> В настройках виджета (вкладка «Интеграции») вставьте домен и токен в соответствующие поля.<br><b>5.</b> Сохраните настройки.<br><br>При каждой новой заявке в amoCRM будут автоматически создаваться <b>сделка</b> и <b>контакт</b> с именем, телефоном, email и названием приза.'
			},
			{
				question: 'Как настроить Яндекс Метрику и ВКонтакте Пиксель?',
				answerHtml:
					'Убедитесь, что счётчик Яндекс Метрики или пиксель ВКонтакте уже установлен на вашем сайте. В настройках виджета укажите ID счётчика или пикселя. Виджет автоматически будет отправлять цели: ip3_open — при открытии колеса, ip3_send — при отправке заявки.'
			},
			{
				question: 'Как подключить Roistat?',
				answerHtml:
					'Установите счётчик Roistat на ваш сайт стандартным способом. В настройках виджета включите чекбокс «Roistat». Никакой дополнительной настройки не требуется — виджет автоматически определит наличие Roistat на странице и будет передавать события.'
			},
			{
				question: 'Как настроить Webhook (внешний URL)?',
				answerHtml:
					'Укажите URL вашего сервера или сервиса (например, Make, n8n, Zapier) в поле «Webhook URL». При каждой новой заявке мы отправим на этот адрес POST-запрос с данными лида в формате JSON: имя, телефон, email, приз, страница и дата.'
			}
		]
	},
	cta: {
		enabled: true,
		text: 'Попробуйте сейчас\nи начните получать больше заявок уже через 10 минут',
		buttonText: 'Начать бесплатный период',
		benefits: [
			{
				text: 'Безопасная оплата\nчерез ЮKassa'
			},
			{
				text: '7 дней полного\nдоступа'
			},
			{
				text: 'Работа в интересах\nбизнеса'
			}
		]
	},
	footer: DEFAULT_HOME_PAGE_FOOTER_CONTENT,
	head: DEFAULT_HOME_PAGE_HEAD_CONTENT,
	body: DEFAULT_HOME_PAGE_BODY_CONTENT
}

export const normalizeHomePageDemoWidgetsContent = (
	value: unknown
): HomePageContent['demoWidgets'] =>
	normalizeDemoWidgetsContent(value, DEFAULT_HOME_PAGE_CONTENT.demoWidgets)

export const normalizeHomePageContent = (
	value?: unknown
): HomePageContent => {
	if (!isRecord(value)) return clone(DEFAULT_HOME_PAGE_CONTENT)

	const content = value as Partial<HomePageContent>
	const defaultContent = clone(DEFAULT_HOME_PAGE_CONTENT)
	const integrations = mergeObject(
		defaultContent.integrations,
		content.integrations
	)

	const integrationItems: HomePageContent['integrations']['items'] =
		mergeSimpleArray(
			isRecord(content.integrations)
				? content.integrations.items
				: undefined,
			defaultContent.integrations.items
		).map((item, index) => ({
			...item,
			iconKey: normalizeIconKey(
				item.iconKey,
				defaultContent.integrations.items[index]?.iconKey ?? 'webhook'
			)
		}))

	return {
		...defaultContent,
		...content,
		ecosystem: normalizeMarketingContent(
			content.ecosystem,
			defaultContent.ecosystem
		),
		crmProduct: normalizeMarketingContent(
			content.crmProduct,
			defaultContent.crmProduct
		),
		seo: mergeObject(defaultContent.seo, content.seo),
		technicalSeo: {
			...mergeObject(defaultContent.technicalSeo, content.technicalSeo),
			baseUrl: normalizeBaseUrl(
				isRecord(content.technicalSeo)
					? content.technicalSeo.baseUrl
					: undefined,
				defaultContent.technicalSeo.baseUrl
			),
			robotsDisallow: mergeRobotsDisallow(
				isRecord(content.technicalSeo)
					? content.technicalSeo.robotsDisallow
					: undefined,
				defaultContent.technicalSeo.robotsDisallow
			),
			sitemapItems: mergeSitemapItems(
				isRecord(content.technicalSeo)
					? content.technicalSeo.sitemapItems
					: undefined,
				defaultContent.technicalSeo.sitemapItems
			)
		},
		demoWidgets: normalizeDemoWidgetsContent(
			content.demoWidgets,
			defaultContent.demoWidgets
		),
		hero: {
			...mergeObject(defaultContent.hero, content.hero),
			benefits: mergeSimpleArray(
				isRecord(content.hero) ? content.hero.benefits : undefined,
				defaultContent.hero.benefits
			)
		},
		analysis: {
			...defaultContent.analysis,
			...(isRecord(content.analysis) ? content.analysis : {}),
			cards: mergeSimpleArray(
				isRecord(content.analysis) ? content.analysis.cards : undefined,
				defaultContent.analysis.cards
			)
		},
		integrations: {
			...integrations,
			items: integrationItems
		},
		tools: {
			...defaultContent.tools,
			...(isRecord(content.tools) ? content.tools : {}),
			items: mergeToolItems(
				isRecord(content.tools) ? content.tools.items : undefined,
				defaultContent.tools.items
			)
		},
		audiences: {
			...defaultContent.audiences,
			...(isRecord(content.audiences) ? content.audiences : {}),
			items: mergeSimpleArray(
				isRecord(content.audiences) ? content.audiences.items : undefined,
				defaultContent.audiences.items
			)
		},
		caseStudies: {
			...defaultContent.caseStudies,
			...(isRecord(content.caseStudies) ? content.caseStudies : {}),
			items: mergeSimpleArray(
				isRecord(content.caseStudies)
					? content.caseStudies.items
					: undefined,
				defaultContent.caseStudies.items
			)
		},
		leadFlow: {
			...defaultContent.leadFlow,
			...(isRecord(content.leadFlow) ? content.leadFlow : {}),
			items: mergeSimpleArray(
				isRecord(content.leadFlow) ? content.leadFlow.items : undefined,
				defaultContent.leadFlow.items
			)
		},
		whyWidgets: {
			...defaultContent.whyWidgets,
			...(isRecord(content.whyWidgets) ? content.whyWidgets : {}),
			formItems: mergeSimpleArray(
				isRecord(content.whyWidgets)
					? content.whyWidgets.formItems
					: undefined,
				defaultContent.whyWidgets.formItems
			),
			widgetItems: mergeSimpleArray(
				isRecord(content.whyWidgets)
					? content.whyWidgets.widgetItems
					: undefined,
				defaultContent.whyWidgets.widgetItems
			)
		},
		steps: {
			...defaultContent.steps,
			...(isRecord(content.steps) ? content.steps : {}),
			items: mergeSimpleArray(
				isRecord(content.steps) ? content.steps.items : undefined,
				defaultContent.steps.items
			)
		},
		customization: {
			...defaultContent.customization,
			...(isRecord(content.customization) ? content.customization : {}),
			cards: mergeSimpleArray(
				isRecord(content.customization)
					? content.customization.cards
					: undefined,
				defaultContent.customization.cards
			),
			features: mergeSimpleArray(
				isRecord(content.customization)
					? content.customization.features
					: undefined,
				defaultContent.customization.features
			)
		},
		dashboardPreview: {
			...defaultContent.dashboardPreview,
			...(isRecord(content.dashboardPreview)
				? content.dashboardPreview
				: {}),
			cards: mergeSimpleArray(
				isRecord(content.dashboardPreview)
					? content.dashboardPreview.cards
					: undefined,
				defaultContent.dashboardPreview.cards
			),
			metrics: mergeSimpleArray(
				isRecord(content.dashboardPreview)
					? content.dashboardPreview.metrics
					: undefined,
				defaultContent.dashboardPreview.metrics
			)
		},
		directLink: {
			...defaultContent.directLink,
			...(isRecord(content.directLink) ? content.directLink : {}),
			items: mergeSimpleArray(
				isRecord(content.directLink)
					? content.directLink.items
					: undefined,
				defaultContent.directLink.items
			)
		},
		security: {
			...defaultContent.security,
			...(isRecord(content.security) ? content.security : {}),
			items: mergeSimpleArray(
				isRecord(content.security) ? content.security.items : undefined,
				defaultContent.security.items
			)
		},
		subscriptionBundle: {
			...defaultContent.subscriptionBundle,
			...(isRecord(content.subscriptionBundle)
				? content.subscriptionBundle
				: {}),
			items: mergeSimpleArray(
				isRecord(content.subscriptionBundle)
					? content.subscriptionBundle.items
					: undefined,
				defaultContent.subscriptionBundle.items
			)
		},
		tariffComparison: {
			...defaultContent.tariffComparison,
			...(isRecord(content.tariffComparison)
				? content.tariffComparison
				: {}),
			rows: mergeSimpleArray(
				isRecord(content.tariffComparison)
					? content.tariffComparison.rows
					: undefined,
				defaultContent.tariffComparison.rows
			)
		},
		pricing: {
			...defaultContent.pricing,
			...(isRecord(content.pricing) ? content.pricing : {}),
			plans: mergePricingPlans(
				isRecord(content.pricing) ? content.pricing.plans : undefined,
				defaultContent.pricing.plans
			)
		},
		microCta: mergeObject(defaultContent.microCta, content.microCta),
		seoText: mergeObject(defaultContent.seoText, content.seoText),
		payment: mergePaymentContent(content.payment, defaultContent.payment),
		faq: {
			...defaultContent.faq,
			...(isRecord(content.faq) ? content.faq : {}),
			items: mergeSimpleArray(
				isRecord(content.faq) ? content.faq.items : undefined,
				defaultContent.faq.items
			)
		},
		cta: {
			...mergeObject(defaultContent.cta, content.cta),
			benefits: mergeSimpleArray(
				isRecord(content.cta) ? content.cta.benefits : undefined,
				defaultContent.cta.benefits
			)
		},
		footer: {
			...mergeObject(defaultContent.footer, content.footer),
			infoLines: mergeStringArray(
				isRecord(content.footer) ? content.footer.infoLines : undefined,
				defaultContent.footer.infoLines
			)
		},
		head: {
			...mergeObject(defaultContent.head, content.head),
			enabled:
				isRecord(content.head) && typeof content.head.enabled === 'boolean'
					? content.head.enabled
					: defaultContent.head.enabled,
			html:
				isRecord(content.head) && typeof content.head.html === 'string'
					? content.head.html
					: defaultContent.head.html
		},
		body: {
			...mergeObject(defaultContent.body, content.body),
			enabled:
				isRecord(content.body) && typeof content.body.enabled === 'boolean'
					? content.body.enabled
					: defaultContent.body.enabled,
			html:
				isRecord(content.body) && typeof content.body.html === 'string'
					? content.body.html
					: defaultContent.body.html
		}
	}
}
