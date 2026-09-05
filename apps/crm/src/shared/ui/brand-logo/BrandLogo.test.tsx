import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import { BrandLogo } from './BrandLogo'
import styles from './BrandLogo.module.scss'

afterEach(cleanup)

describe('WinCRM vector wordmark', () => {
	it('renders one accessible brand without a tile, visible text or font dependency', () => {
		const { container } = render(<BrandLogo />)
		const label = screen.getByText('WinCRM')
		expect(label.className).toBe(styles.srOnly)
		expect(container.querySelector('a')).toBeNull()
		const svg = container.querySelector('svg')!
		expect(svg.getAttribute('fill')).toBe('currentColor')
		expect(svg.getAttribute('aria-hidden')).toBe('true')
		expect(svg.getAttribute('focusable')).toBe('false')
		expect(svg.getAttribute('viewBox')).toBe('0 0 86800 10622.79')
		expect(svg.classList.contains(styles.wordmark)).toBe(true)
		expect(svg.querySelector('text, image, rect')).toBeNull()
		expect(svg.querySelectorAll('g path')).toHaveLength(3)
	})

	it('preserves the exact WIN outline from the canonical WinWidget logo', () => {
		const canonical = readFileSync(
			resolve(
				process.cwd(),
				'../../packages/winwidget-web/src/shared/ui/logo-image/LogoImage.tsx'
			),
			'utf8'
		)
		const originalWin = [...canonical.matchAll(/\bd="([^"]+)"/g)][1][1]
		const { container } = render(<BrandLogo />)
		expect(container.querySelector('svg > path')?.getAttribute('d')).toBe(
			originalWin
		)
	})

	it('keeps the existing link contract and caller styling', () => {
		render(<BrandLogo href="/inbox" className="custom-brand" />)
		const link = screen.getByRole('link', { name: 'WinCRM' })
		expect(link.getAttribute('href')).toBe('/inbox')
		expect(link.classList.contains('custom-brand')).toBe(true)
		expect(link.classList.contains(styles.logo)).toBe(true)
	})

	it('gives each server-rendered wordmark its own horizontal-cut reference', () => {
		const container = document.createElement('div')
		container.innerHTML = renderToStaticMarkup(
			<>
				<BrandLogo />
				<BrandLogo href="/inbox" />
			</>
		)
		const ids = [...container.querySelectorAll('clipPath')].map(
			clip => clip.id
		)
		expect(new Set(ids).size).toBe(2)
		for (const svg of container.querySelectorAll('svg')) {
			const id = svg.querySelector('clipPath')!.id
			expect(
				svg.querySelector('[clip-path]')?.getAttribute('clip-path')
			).toBe(`url(#${id})`)
		}
	})
})
