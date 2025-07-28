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

		// Disable problematic rules for cloud-sync branch
		'ts/no-unused-vars': 'off',
		'unused-imports/no-unused-vars': 'off',
		'ts/explicit-function-return-type': 'off',
		'node/prefer-global/process': 'off',
		'node/prefer-global/buffer': 'off',
		'style/max-statements-per-line': 'off',
		'antfu/no-top-level-await': 'off',
		'ts/restrict-template-expressions': 'off',
		'ts/unbound-method': 'off',
		'ts/no-misused-promises': 'off',
	},
});
