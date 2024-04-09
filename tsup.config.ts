import { defineConfig } from 'tsup';

const config = defineConfig({
	entry: ['src/index.ts'],
	publicDir: 'public/',

	target: 'esnext',
	format: ['cjs'],

	cjsInterop: true,
	clean: true,
	dts: true,
	splitting: false,
	sourcemap: true,

	minify: true,
});
export default config;
