/* eslint-env node */
require('@rushstack/eslint-patch/modern-module-resolution');

module.exports = {
	root: true,
	extends: [
		// 'plugin:vue/vue3-recommended',
		// 'plugin:vue-pug/vue3-recommended',
		'eslint:recommended',
		'@vue/eslint-config-typescript',
		'@vue/eslint-config-prettier',
	],
	parser: 'vue-eslint-parser',
	parserOptions: {
		ecmaVersion: 'latest',
	},
	rules: {
		// 'prettier/prettier': [
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
