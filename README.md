# dum-packer v0

> "_Only a dum-packer would know._" - K. Krule, 2017

A dum way to pack a web application into a daft little bundle.

This system is designed to bundle parts of a web-based project into a single HTML file that is readable and straight-forward. Effectively, it just slots your HTML/code/styling into their respective areas.

**Looking for a dum web framework?** Let me introduce you to my friend, [dum-dom](http://github.com/afewlines/dum-dom-v0).

**This repository is still way deep in development. Anything and everything is liable to change depending on my wants and whims.**

## Features

- **Single-file Output:** Code feeling lonely and detached from its loved ones? Worry not; all code rendered unto dum-packer will be spat back out within the confines of a single html file.
- **No-setup Translation:** Tired of html files just not speakin' your language? Wish you could develop a simple webpage with Pug, TypeScript, and SCSS without setting up a whole build system? At last, a packer that can understands _you_!
- **Minification & Beautification:** I just... it's so annoying to have to set up half-a-dozen packages when I just want to make a simple web page.
- **Development Server & Hot Reload:** Develop like the wind with our built-in development server with hot reload capabilities. I'm bored of rewriting this readme so TODO continue here some other time.

## Table of Contents

- [Installation](#installation)
- [Supported Languages](#supported-languages)
  - [Markdown/Templates](#markdowntemplates)
  - [Styling](#styling)
  - [Code](#code)
- [Caveats](#caveats)
- [Usage](#usage)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## Supported Languages

### Markdown/Templates

- HTML
- PUG

### Styling

- CSS
- SCSS/Sass

### Code

- JavaScript
- TypeScript

## Caveats

- If you decide to use this, remember that it's dum.
- Use ESM, don't use `default` exports.
- No contents from `node_modules` will be bundled in the project.
  - Import from a CDN & use the import map option for external modules when possible.
- Include the <html> tag in the template page.
- The built project will be emitted to the current directory

# Usage

Dumb simple: import the `DumPackerProject` class, instantiate it with your project's options, call `.run()` or `.build()`, and you're golden.

Module resolution at runtime is handled by dum-imex. Any import or export calls will be converted to `__dum_import` and `__dum_export` calls. A global object, `__dum_scope`, is used to hold exported items. Defaults and side-effect imports will be omitted. To disable dum-imex, set `disable_imex` to `false` in the project's options.

The packer will generate a dependency tree from files indicated in `code`, translate all `code` files and local dependencies, transform them into dum-imex format, toss'em in separate closures, then append them in separate `script` tags to the end of the document's body.

Adding the comment `__dum_omit` will exclude a line from the output.

Adding the comment `__dum_ignore` will prevent the dum-imex transform from affecting a line.

Setting `disable_imex` in the project's settings to `true` will skip the dum-imex system & its translation entirely. This is useful when integrating a bundler such as esbuild.

## Example

File structure

```
root_dir/
	public/
    src/
        index.pug
        index.ts
        style.scss
    main.js
```

main.js

```javascript
import { DumPackerProject } from 'dum-packer';

const project = new DumPackerProject({
	// required; project/output file name
	name: 'dum-packer-example',

	// required; base for project's files
	// used as base path for modules
	base_dir: 'src/',

	// required; single file
	page: 'src/index.pug',
	// optional; single file or array
	style: ['src/style.scss'],
	// optional; single file or array
	code: 'src/index.ts',

	// optional; html import map script type w/o scopes
	import_map: {
		package: 'CDN url',
	},

	disable_imex: false, // optional; disables dum-imex

	build_options: {
		// optional; minify.Options, minifies when not undefined
		minify: {},
		// optional; prettier.Options, beautifies when not undefined & not minified
		beautify: {},

		// optional; any value besides undefined will watch for file changes, rebuild when triggered
		watcher: {
			watcher_dir: 'src/', // optional; directory to watch. default: project.base_dir
		},

		// optional; any value besides undefined will serve project
		server: {
			hostname: '0.0.0.0', // optional. default: localhost
			port: 5888, // optional. default: 5174
			server_dir: 'public/', // optional; directory to serve. default: project.base_dir
			hot_reload: true, // optional; enable hot reload, requires watcher to be started
		},
	},

	project_hooks: {
		// will document eventually...
		// general schema is that if you return `false` the build/response will be aborted, return `true` and everything continues normally
		// for the `process_` hooks, if a string is returned it'll be used as the contents of the file indicated in the hook's params
		// for the `on_serve` hook, returning a string sets the resolution path for the server request
	},
});

// builds project, starts watcher/server
// if neither set, just build synchronously
await project.run();

// to just build project
// note that build options will be respected; if set to hot reload, related code will be inserted, but the watcher/server will not be run
await project.build();

// output: root_dir/dum-packer-example.html
```

## Future Plans

I'll probably keep tinkering with this whenever I find things to tweak or features to add. I'll (try to) keep an eye on the repo, so you're encouraged to lodge any bugs/suggestions/complaints/comments/concerns there.

### Things that are likely:

- Option to determine where built project file goes (it doesn't feel necessary yet; this packer is dum)

### Things that are less likely, but not unlikely:

- Loader system to allow for more supported languages
- CLI tool

### Things that, if I have my way, will not happen:

- Default exports (get outta here with that)
- Bundling modules in `node_modules`
- Module systems besides ESM (unless covered via the loader system)
