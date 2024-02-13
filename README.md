# dum-packer

A dumb way to pack a web application into a daft little bundle.

This package is designed to bundle parts of a web-based project into a single html file that is readable and straight-forward. Effectively, it just slots your html/code/styling into their respective areas.

## Features

- Single file output
- Automatic translation to html/css/js
- Minification & formatting/beautifier
- Development server/hot reload

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

- If you decide to use this, remember that it's dumb.
- Use ESM, don't use `default` exports.
- No contents from `node_modules` will be bundled in the project.
  - Import from a CDN & use the import map option for external modules when possible.
- Include the <html> tag in the template page.
- The built project will be emitted to the current directory

# Example

File structure

```
root_dir/
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
	style: 'src/style.scss',
	// optional; single file or array
	code: ['src/index.ts'],

	// optional; html import map script type w/o scopes
	import_map: {
		package: 'CDN url',
	},

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
			hostname: 'localhost', // optional. default: localhost
			port: 5888, // optional. default: 5174
			server_dir: 'src/', // optional; directory to serve. default: project.base_dir
			hot_reload: true, // optional; enable hot reload, requires watcher to be started
		},
	},
});

// builds project, starts watcher/server
// if neither set, just build synchronously
project.run();

// to just build project (async)
// note that build options will be respected; if set to hot reload, related code will be inserted, but the watcher/server will not be run
project.build();

// output: root_dir/dum-packer-example.html
```

## Future Plans

I'll probably keep tinkering with this whenever I find things to tweak or features to add. I'll (try to) keep an eye on the repo, so you're encouraged to lodge any bugs/suggestions/complaints/comments/concerns there.

(Same thing if there's any metadata for this package/repo that doesn't seem right; this is my first published package.)

Things that are likely:

- Option to disable dum_module system and/or closures
  - Former will probably just be based on if it's needed or not
- Option to determine where built project file goes (it doesn't feel necessary; this packer is dumb)
- More options for ~~minification, server,~~ other obfuscated elements

Things that are less likely, but not unlikely:

- Loader system to allow for more supported languages
- CLI tool

Things that are unlikely:

- Router/single-page application system (you probably want another packer if you're looking to do this)

Things that, if I have my way, will not happen:

- Default exports (get outta here with that)
- Bundling modules in `node_modules`
- Module systems besides ESM (unless covered via the loader system)
- Any sort of meaningful testing
