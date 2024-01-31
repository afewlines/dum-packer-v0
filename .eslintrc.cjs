/* eslint-env node */
// require('@rushstack/eslint-patch/modern-module-resolution');

module.exports = {
	root: true,
	extends: [
		'eslint:recommended',
		'plugin:@typescript-eslint/eslint-recommended',
		'plugin:@typescript-eslint/recommended',
		'plugin:prettier/recommended',
	],
	parser: '@typescript-eslint/parser',
	plugins: ['@typescript-eslint'],
	parserOptions: {
		ecmaVersion: 'latest',
	},
	rules: {
		'no-unused-vars': 'off',
		'@typescript-eslint/no-unused-vars': [
			'error',
			{ varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
		],
		'prettier/prettier': 'warn',
		// 'off',
		// {
		// $schema: "http://json.schemastore.org/prettierrc",
		// endOfLine: "auto",
		// trailingComma: "es5",
		// useTabs: true,
		// tabWidth: 2,
		// semi: true,
		// singleQuote: true,
		// quoteProps: "consistent",
		// printWidth: 100
		// },
		// ],
		// '@typescript-eslint/prefer-literal-enum-member': 'off',
	},
};
