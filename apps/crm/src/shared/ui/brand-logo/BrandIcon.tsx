/** Font-independent favicon using the W outline from the WinWidget wordmark. */
export const BrandIcon = ({ size }: { size: number }) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 64 64"
		xmlns="http://www.w3.org/2000/svg"
	>
		<rect width="64" height="64" rx="14" fill="#7b3fa0" />
		<path
			fill="#ffffff"
			transform="translate(9 21) scale(.00212)"
			d="M18272.32 158.81l-5002.95 7620.66 -346.39 0 -192.95 -7620.66 -3795.91 0 -4483.34 7620.66 -346.39 0 -712.61 -7620.66 -3391.76 0 1097.13 10305.22 4863.97 0 3525.91 -6321.72c15.04,-19.25 108.81,-266.99 281.41,-743.31 172.55,-476.27 287.68,-714.43 345.44,-714.43 67.33,0 53.21,238.16 -42.34,714.43 -95.59,476.32 -146.07,724.06 -151.48,743.31l-18.73 6321.72 4863.97 0 6898.8 -10305.22 -3391.76 0z"
		/>
	</svg>
)
