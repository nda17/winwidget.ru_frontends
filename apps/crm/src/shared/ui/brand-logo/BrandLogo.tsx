import clsx from 'clsx'
import Link from 'next/link'
import { useId } from 'react'

import styles from './BrandLogo.module.scss'

export interface BrandLogoProps {
	href?: string
	className?: string
}

const LogoContent = () => {
	const cutId = useId()

	return (
		<>
			<svg
				className={styles.wordmark}
				viewBox="0 0 86800 10622.79"
				fill="currentColor"
				aria-hidden="true"
				focusable="false"
			>
				{/* WIN is the original WinWidget wordmark outline, not a font. */}
				<path d="M18272.32 158.81l-5002.95 7620.66 -346.39 0 -192.95 -7620.66 -3795.91 0 -4483.34 7620.66 -346.39 0 -712.61 -7620.66 -3391.76 0 1097.13 10305.22 4863.97 0 3525.91 -6321.72c15.04,-19.25 108.81,-266.99 281.41,-743.31 172.55,-476.27 287.68,-714.43 345.44,-714.43 67.33,0 53.21,238.16 -42.34,714.43 -95.59,476.32 -146.07,724.06 -151.48,743.31l-18.73 6321.72 4863.97 0 6898.8 -10305.22 -3391.76 0zm1536.43 10334.1l2904.91 -10319.68 3175.3 0 -2904.91 10319.68 -3175.3 0zm22519.51 -10319.68l-3175.3 0 -2002.26 7113.11c1.15,269.43 2.97,536.42 6.8,796.23 -27.11,96.21 -49.33,192.42 -66.81,288.64 -67.38,0 -114.75,-62.5 -142.04,-187.59 -27.35,-125.09 -52.3,-250.18 -74.81,-375.27l-3277.59 -7635.12 -5195.95 0 -2904.91 10319.68 3175.3 0 2006.38 -7127.58c2.68,-9.63 -4.6,-274.22 -21.22,-796.23 17.43,-96.21 39.7,-192.42 66.76,-288.64 67.38,0 114.08,64.94 140.03,194.82 26,129.93 51.58,252.58 76.82,368.04l3287.99 7649.59 5195.9 0 2904.91 -10319.68z" />
				<defs>
					<clipPath id={cutId}>
						<path d="M-300 0H4500V246.3H-300ZM-300 391.5H4500V1031H-300Z" />
					</clipPath>
				</defs>
				<g transform="translate(44800 158.81) scale(10)">
					{/* The product suffix repeats the original slope and horizontal cut. */}
					<g clipPath={`url(#${cutId})`}>
						<path
							transform="matrix(1 0 -.2815 1 0 0)"
							d="M1200 0H420C110 0 0 100 0 350V680C0 930 110 1030 420 1030H1200V765H465C340 765 318 728 318 650V380C318 305 340 270 465 270H1200Z"
						/>
						<path
							transform="matrix(1 0 -.2815 1 1390 0)"
							fillRule="evenodd"
							d="M0 0H860C1160 0 1320 100 1320 380C1320 600 1180 725 1020 742L1370 1030H955L635 752H318V1030H0ZM318 270V487H800C930 487 975 467 975 380C975 300 930 270 800 270Z"
						/>
						<path
							transform="matrix(1 0 -.2815 1 2850 0)"
							d="M0 1030V0H400L675 600L950 0H1350V1030H1032V440L775 1030H575L318 440V1030Z"
						/>
					</g>
				</g>
			</svg>
			<span className={styles.srOnly}>WinCRM</span>
		</>
	)
}

export const BrandLogo = ({ href, className }: BrandLogoProps) => {
	const logoClassName = clsx(styles.logo, className)

	if (href) {
		return (
			<Link href={href} className={logoClassName} aria-label="WinCRM">
				<LogoContent />
			</Link>
		)
	}

	return (
		<span className={logoClassName}>
			<LogoContent />
		</span>
	)
}
