import { ryoppippi } from '@ryoppippi/eslint-config';

export default ryoppippi({
	type: 'lib',
	svelte: false,
	typescript: {
		tsconfigPath: './tsconfig.json',
	},
	ignores: [
		'docs/**',
	],
	rules: {
		// Disable rules that don't work well with @praha/byethrow Result type
		'ts/no-unsafe-assignment': 'off',
		'ts/no-unsafe-argument': 'off',
		'ts/no-unsafe-member-access': 'off',
		'ts/no-unsafe-return': 'off',
		'ts/no-unsafe-call': 'off',
		'ts/strict-boolean-expressions': 'off',
	},
});
