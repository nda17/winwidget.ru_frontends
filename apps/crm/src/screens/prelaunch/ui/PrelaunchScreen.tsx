import { AppIcon } from '@/shared/ui/app-icon'
import { BrandLogo } from '@/shared/ui/brand-logo'

import styles from './PrelaunchScreen.module.scss'

interface PrelaunchScreenProps {
	mainAppOrigin: string
}

export const PrelaunchScreen = ({
	mainAppOrigin
}: PrelaunchScreenProps) => (
	<div className={styles.page}>
		<div className={styles.glow} aria-hidden="true" />
		<div className={styles.container}>
			<header className={styles.header}>
				<BrandLogo />
				<span className={styles.status}>
					<span className={styles.statusDot} aria-hidden="true" />
					Готовимся к запуску
				</span>
			</header>
			<main className={styles.main}>
				<section className={styles.card} aria-labelledby="prelaunch-title">
					<p className={styles.eyebrow}>НОВОЕ В ЭКОСИСТЕМЕ WINWIDGET</p>
					<h1 id="prelaunch-title" className={styles.title}>
						WinCRM <span>Скоро</span>
					</h1>
					<p className={styles.lead}>
						Клиенты, сделки и задачи — в одном рабочем пространстве.
					</p>
					<ul className={styles.features} aria-label="Разделы WinCRM">
						<li>
							<AppIcon name="contacts" size={20} /> Клиенты
						</li>
						<li>
							<AppIcon name="deals" size={20} /> Сделки
						</li>
						<li>
							<AppIcon name="tasks" size={20} /> Задачи
						</li>
					</ul>
					<div className={styles.divider} />
					<p className={styles.description}>
						Мы готовим WinCRM к запуску. Пока вы можете продолжать работу с
						виджетами в WinWidget.
					</p>
					<a className={styles.mainLink} href={mainAppOrigin}>
						Перейти в WinWidget <span aria-hidden="true">→</span>
					</a>
					<p className={styles.note}>
						CRM и виджеты — отдельные продукты.
						<br />
						Подключение CRM будет по вашему выбору.
					</p>
				</section>
			</main>
			<footer className={styles.footer}>
				WinCRM · Часть экосистемы WinWidget
			</footer>
		</div>
	</div>
)
