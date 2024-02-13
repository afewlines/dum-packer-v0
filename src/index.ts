import * as fs from 'fs';
import * as dt from 'dependency-tree';
import * as minify from 'html-minifier-terser';
import * as jsdom from 'jsdom';
import * as http from 'node:http';
import * as path from 'path';
import * as pug from 'pug';
import * as sass from 'sass';
import * as socketio from 'socket.io';
import * as ts from 'typescript';
import * as prettier from 'prettier';
import watch from 'node-watch';

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 5174;

const IMEX_IMPORT_REGEX =
	/^\s*import\s+(?:(?:\{(?<named>.+)})|(?:\*\s+as\s+(?<namespace>\w+)))\s+from\s+['"]\s*(?<source>.+)\s*['"]\s*;/i;
const IMEX_EXPORT_REGEX =
	/^export\s+(?:(?:(?:async)|(?:function)|(?:interface)|(?:class)|(?:enum)|(?:const)|(?:var))\s+)+(?<name>\w+)/i;

const IMEX_RAW = fs.readFileSync(path.resolve(__dirname, 'imex_client.js'), {}).toString();
const HOT_RELOAD_RAW = fs
	.readFileSync(path.resolve(__dirname, 'hot_reload_client.js'), {})
	.toString();

interface ServerState {
	server: http.Server;
	ssock?: socketio.Server;
	hr_state?: {
		session: number;
		version: number;
	};
}
export interface ScopelessImportMap {
	[import_name: string]: string;
}
export interface DumPackerBuildOpts {
	/** should minify / 'minify' options */
	minify?: minify.Options;
	/** should beautify / 'prettier' options */
	beautify?: prettier.Options;

	/** watcher, will build projects on file change if not undefined */
	watcher?: {
		watcher_dir?: string; // directory to watch. default: project.base_dir
	};

	/** local server, will run server if not undefined*/
	server?: {
		hostname?: string; // default: localhost
		port?: number; // default: 5174
		server_dir?: string; // directory to serve. default: project.base_dir
		hot_reload?: boolean; // should hot reload when watcher issues new build
	};
}
export interface DumPackerProjectOpts {
	/** name of the project & output.html */
	name: string;
	/** root dir for project */
	base_dir: string;

	/** target page template
	 * [.pug, .html]
	 */
	page: string;
	/** target style sheet(s)
	 * [.scss, .sass, .css]
	 */
	style?: string | string[];
	/** target code items(s)
	 * [.ts, .js]
	 */
	code?: string | string[];
	/** import map */
	import_map?: ScopelessImportMap;

	/** build options */
	build_options?: DumPackerBuildOpts;
}

class SetList<T> extends Array<T> {
	constructor(...items: T[]) {
		super(...items);
	}

	public push(...items: T[]): number {
		let i = this.length;
		for (const item of items) {
			if (this.includes(item)) continue;
			else this[i++] = item;
		}
		return this.length;
	}

	public unshift(...items: T[]): number {
		let i = this.length;
		for (const item of items) {
			if (this.includes(item)) continue;
			else i = super.unshift(item);
		}
		return i;
	}
}

// general helpers
/** simple mime type inferrer */
function dum_mime_type(ext: string): string {
	switch (ext.toLowerCase()) {
		case '.epub':
			return 'application/epub+zip';
		case '.gz':
			return 'application/gzip';
		case '.jar':
			return 'application/java-archive';
		case '.json':
			return 'application/json';
		case '.jsonld':
			return 'application/ld+json';
		case '.doc':
			return 'application/msword';
		case '.bin':
			return 'application/octet-stream';
		case '.ogx':
			return 'application/ogg';
		case '.pdf':
			return 'application/pdf';
		case '.rtf':
			return 'application/rtf';
		case '.azw':
			return 'application/vnd.amazon.ebook';
		case '.mpkg':
			return 'application/vnd.apple.installer+xml';
		case '.xul':
			return 'application/vnd.mozilla.xul+xml';
		case '.xls':
			return 'application/vnd.ms-excel';
		case '.eot':
			return 'application/vnd.ms-fontobject';
		case '.ppt':
			return 'application/vnd.ms-powerpoint';
		case '.odp':
			return 'application/vnd.oasis.opendocument.presentation';
		case '.ods':
			return 'application/vnd.oasis.opendocument.spreadsheet';
		case '.odt':
			return 'application/vnd.oasis.opendocument.text';
		case '.pptx':
			return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
		case '.xlsx':
			return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
		case '.docx':
			return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
		case '.rar':
			return 'application/vnd.rar';
		case '.vsd':
			return 'application/vnd.visio';
		case '.7z':
			return 'application/x-7z-compressed';
		case '.abw':
			return 'application/x-abiword';
		case '.bz':
			return 'application/x-bzip';
		case '.bz2':
			return 'application/x-bzip2';
		case '.cda':
			return 'application/x-cdf';
		case '.csh':
			return 'application/x-csh';
		case '.arc':
			return 'application/x-freearc';
		case '.php':
			return 'application/x-httpd-php';
		case '.sh':
			return 'application/x-sh';
		case '.tar':
			return 'application/x-tar';
		case '.xhtml':
			return 'application/xhtml+xml';
		case '.xml':
			return 'application/xml';
		case '.zip':
			return 'application/zip';
		case '.aac':
			return 'audio/aac';
		case '.mid':
		case '.midi':
			return 'audio/midi';
		case '.mp3':
			return 'audio/mpeg';
		case '.oga':
			return 'audio/ogg';
		case '.opus':
			return 'audio/opus';
		case '.wav':
			return 'audio/wav';
		case '.weba':
			return 'audio/webm';
		case '.otf':
			return 'font/otf';
		case '.ttf':
			return 'font/ttf';
		case '.woff':
			return 'font/woff';
		case '.woff2':
			return 'font/woff2';
		case '.apng':
			return 'image/apng';
		case '.avif':
			return 'image/avif';
		case '.bmp':
			return 'image/bmp';
		case '.gif':
			return 'image/gif';
		case '.jpeg':
		case '.jpg':
			return 'image/jpeg';
		case '.png':
			return 'image/png';
		case '.svg':
			return 'image/svg+xml';
		case '.tif':
		case '.tiff':
			return 'image/tiff';
		case '.ico':
			return 'image/vnd.microsoft.icon';
		case '.webp':
			return 'image/webp';
		case '.ics':
			return 'text/calendar';
		case '.css':
			return 'text/css';
		case '.csv':
			return 'text/csv';
		case '.htm':
		case '.html':
			return 'text/html';
		case '.js':
		case '.mjs':
			return 'text/javascript';
		case '.3gp':
			return 'video/3gpp';
		case '.3g2':
			return 'video/3gpp2';
		case '.ts':
			return 'video/mp2t';
		case '.txt':
			return 'text/plain';
		case '.mp4':
			return 'video/mp4';
		case '.mpeg':
			return 'video/mpeg';
		case '.ogv':
			return 'video/ogg';
		case '.webm':
			return 'video/webm';
		case '.avi':
			return 'video/x-msvideo';

		default:
			return 'application/octet-stream';
	}
}
/**get module source relative to base dir
 * @param base_dir string/path: base directory of project
 * @param requester string/path: source file that is importing/exporting
 * @param module_source string/path: normalized path to module from source file
 * @returns string: module path relative to base dir, '/' path separators, no file extension
 */
function clean_module_source(base_dir: string, requester: string, module_source: string): string {
	return path
		.relative(base_dir, path.join(path.dirname(requester), module_source).replace(/\.[^/.]+$/, ''))
		.replaceAll(path.win32.sep, '/');
}

// specific helpers
function dom_prepend_child(parent: HTMLElement, child: HTMLElement): HTMLElement {
	return parent.insertBefore(child, parent.children[0]);
}
function dom_append_child(parent: HTMLElement, child: HTMLElement): HTMLElement {
	return parent.appendChild(child);
}

/** dum loader Project class */
export class DumPackerProject implements DumPackerProjectOpts {
	name: string;
	base_dir: string;

	page: string;
	style?: string[];
	code?: string[];
	import_map?: ScopelessImportMap;

	build_options: DumPackerBuildOpts;
	constructor(opts: DumPackerProjectOpts) {
		this.base_dir = path.relative('.', opts.base_dir);
		this.name = opts.name;
		this.page = opts.page;

		this.style = typeof opts.style === 'string' ? [opts.style] : opts.style;
		this.style?.reverse();

		this.code = typeof opts.code === 'string' ? [opts.code] : opts.code;
		this.code?.reverse();

		this.import_map = opts.import_map;

		this.build_options = Object.assign({}, opts.build_options);
		if (this.build_options.server) {
			this.build_options.server = Object.assign(
				{ server_dir: this.base_dir, hostname: DEFAULT_HOST, port: DEFAULT_PORT },
				this.build_options.server
			);
		}
		if (this.build_options.watcher) {
			this.build_options.watcher = Object.assign(
				{ watcher_dir: this.base_dir },
				this.build_options.watcher
			);
		}
	}

	// template
	private process_template() {
		const raw = fs.readFileSync(this.page, { encoding: 'utf-8' });
		switch (path.extname(this.page).toLowerCase()) {
			case '.pug':
				return pug
					.compile(raw, {
						pretty: true,
					})()
					.replace(new RegExp(/\t/g), '');

			case '.html':
			default:
				return raw;
		}
	}

	// style
	private process_style(dom: jsdom.JSDOM) {
		for (const style of this.style) {
			// append style bucket to head
			dom_append_child(
				dom.window.document.head,
				(() => {
					// read scss/sass, compile
					const style_string = (() => {
						let res = fs.readFileSync(style, { encoding: 'utf-8' });
						const opts: sass.StringOptions<'sync'> = {
							style: this.build_options.minify ? 'compressed' : 'expanded',
							syntax: 'scss',
						};
						switch (path.extname(style).toLocaleLowerCase()) {
							case '.sass':
								opts.syntax = 'indented';
							// fallthrough
							case '.scss':
								res = sass.compileString(res, opts).css.trim();
								break;

							default:
								break;
						}
						return res.trim();
					})();

					// create style bucket, fill
					const bucket = dom.window.document.createElement('style');
					bucket.id = `dum_style_${style}`;
					bucket.innerHTML = `\n${style_string}\n`;
					return bucket;
				})()
			);
		}
	}

	// code
	private translate_code(source_file: string): string | undefined {
		// get source file as path and module name
		source_file = path.normalize(source_file);
		const export_module = clean_module_source(
			this.base_dir,
			source_file,
			path.basename(source_file)
		);

		// transpile code
		let code_js: string = (() => {
			const raw = fs.readFileSync(source_file, { encoding: 'utf-8' });
			const ext = path.extname(source_file).toLocaleLowerCase();
			switch (ext) {
				case '.ts':
					return ts.transpileModule(raw, {
						moduleName: path.basename(export_module),
						compilerOptions: {
							target: ts.ScriptTarget.ESNext,
							module: ts.ModuleKind.ESNext,
						},
					}).outputText;

				default:
					return raw;
			}
		})();

		// loop through lines to find import/exports
		const source_lines = code_js.split('\n');
		const import_lines = [];
		const output_lines = [];
		const export_lines = [];

		for (let i = 0; i < source_lines.length; ++i) {
			const line = source_lines[i].trim();

			const bad_match = /^\s*export\s+{\W*}/i.exec(line);
			// ignore 'export {stuff}' form
			// TODO: allow for this if i find the desire/need
			if (bad_match) continue;

			// do imports
			const import_match = IMEX_IMPORT_REGEX.exec(line);
			if (import_match && import_match.groups) {
				// if it's in the import map, ignore
				output_lines.push(`// ${line.trim()}`);
				if (this.import_map && import_match.groups.source in this.import_map) {
					import_lines.push(line);
					continue;
				}

				const import_module: string = clean_module_source(
					this.base_dir,
					source_file,
					path.normalize(import_match.groups.source)
				);

				if (import_match.groups.namespace) {
					// namespace import
					// import * as example from 'example.ts'
					const imported_namespace = import_match.groups.namespace.trim();
					output_lines.push(`const ${imported_namespace} = __dum_import('${import_module}');`);
				} else if (import_match.groups.named) {
					// named imports
					// import {test1, test2 as other_test} from 'example.ts'
					for (const named of import_match.groups.named.trim().split(',')) {
						const imported_name = named.trim();
						output_lines.push(
							(() => {
								const as_match = /(?<key>\S*)\s+as\s+(?<tform>\S*)/i.exec(imported_name);
								const target_name: string = as_match ? as_match.groups.tform : imported_name,
									item_name: string = as_match ? as_match.groups.key : imported_name;
								return `const ${target_name.trim()} = __dum_import('${import_module}', '${item_name.trim()}');`;
							})()
						);
					}
				}
				continue; // line done
			}

			// aaaaand exports
			const export_match = IMEX_EXPORT_REGEX.exec(line);
			if (export_match && export_match.groups) {
				output_lines.push(`// ${line.trim()}`);

				const ne = export_match.groups.name.trim();
				const nline = `__dum_export('${export_module}', '${ne}', ${ne});`;
				export_lines.push(nline);
				output_lines.push(line.replace(/^\s*export\s+/i, ''));

				continue; // line done
			}

			// anything else, just push line
			output_lines.push(line);
		}

		// concat actual code and exports
		code_js = (output_lines.join('\n') + export_lines.join('\n')).trim();

		// if there was no actual code or actual export (eg: .ts files only exporting types),
		// skip the file
		if (code_js.length) {
			// TODO: closure option
			// concat import_map imports to code
			return `${import_lines.join('\n')}\n(()=>{\n${code_js}\n})();`.trim();
		} else return undefined;
	}
	private process_code(dom: jsdom.JSDOM) {
		if (this.code == undefined) return;

		// find dependencies list
		const dep_list = new SetList<string>();
		// const unresolved = new SetList<string>();
		for (const entry_point of this.code) {
			// const nexistent = [];
			dep_list.push(
				...dt.toList({
					directory: this.base_dir,
					filename: entry_point,
					noTypeDefinitions: true,
					// nonExistent: nexistent,
					filter: (path) => path.indexOf('node_modules') === -1,
				})
			);
			// unresolved.push(...nexistent);
		}

		// process and add code, starting at last dependency
		for (const source_file of dep_list.reverse()) {
			// translate the code
			const code_result = this.translate_code(source_file);
			// if skippable (.ts files only exporting types)
			if (code_result == undefined) continue;

			// add modularized code to dom
			dom_prepend_child(
				dom.window.document.body,
				(() => {
					const bucket = dom.window.document.createElement('script');
					bucket.id = `dum_code-${clean_module_source(this.base_dir, '', source_file)}`;
					bucket.innerHTML = `\n${code_result}\n`;
					bucket.type = 'module';
					return bucket;
				})()
			);
		}

		// add dum module (IMEX) code to dom
		dom_prepend_child(
			dom.window.document.body,
			(() => {
				const bucket = dom.window.document.createElement('script');
				bucket.id = `dum_IMEX`;
				bucket.innerHTML = `\n${IMEX_RAW}\n`;
				// bucket.type = 'module';
				return bucket;
			})()
		);

		// add import map to dom
		if (this.import_map) {
			dom_prepend_child(
				dom.window.document.body,
				(() => {
					const bucket = dom.window.document.createElement('script');
					bucket.id = 'dum_IMPORT_MAP';
					bucket.type = 'importmap';
					bucket.innerHTML = `\n${JSON.stringify({ imports: this.import_map }, undefined, this.build_options.minify ? undefined : 4)}\n`;
					return bucket;
				})()
			);
		}
	}

	public async build(): Promise<string> {
		console.log(`BUILD\tstarting\t'${this.name}'`);

		// create new pseudo-dom from html
		const dom = new jsdom.JSDOM(this.process_template());
		if (this.style) this.process_style(dom);
		if (this.code) this.process_code(dom);

		// do hot reload
		if (this.build_options?.server?.hot_reload) {
			// get server's socket io
			dom_append_child(
				dom.window.document.head,
				(() => {
					const bucket = dom.window.document.createElement('script');
					bucket.src = `http://${this.build_options.server.hostname}:${this.build_options.server.port}/socket.io/socket.io.js`;
					return bucket;
				})()
			);

			// insert code
			dom_append_child(
				dom.window.document.body,
				(() => {
					const bucket = dom.window.document.createElement('script');
					bucket.id = 'dum_HOT_RELOAD';
					bucket.innerHTML =
						'\n' +
						HOT_RELOAD_RAW.replace('$HOST', this.build_options.server.hostname)
							.replace('$PORT', `${this.build_options.server.port}`)
							.trim() +
						'\n';
					return bucket;
				})()
			);
		}

		// rasterize dom
		let html_string = dom.serialize();
		const html_file = `${this.name}.html`;

		// minimize or beautify
		if (this.build_options.minify) {
			html_string = await minify.minify(
				html_string,
				Object.assign(
					{
						removeComments: true,
						collapseBooleanAttributes: true,
						collapseWhitespace: true,
						collapseInlineTagWhitespace: true,
						minifyCSS: true,
						minifyJS: true,
						noNewlinesBeforeTagClose: true,
						sortAttributes: true,
					},
					this.build_options.minify
				)
			);
		} else if (this.build_options.beautify) {
			html_string = await prettier.format(
				html_string,
				Object.assign(
					{
						parser: 'html',

						arrowParens: 'always',
						bracketSameLine: true,
						bracketSpacing: true,
						embeddedLanguageFormatting: 'auto',
						endOfLine: 'lf',
						printWidth: 120,
						quoteProps: 'consistent',
						semi: true,
						singleAttributePerLine: true,
						singleQuote: true,
						trailingComma: 'es5',
						tabWidth: 2,
						useTabs: true,
					},
					this.build_options.beautify
				)
			);
		}

		fs.writeFileSync(html_file, html_string);
		console.log(`BUILD\tsucceeded\t'${html_file}'\t${html_string.length / 1024}kb`);
		return html_string;
	}

	async run() {
		let last_build = await this.build();
		let is_building: boolean = false;

		const init_watcher = (serv?: ServerState) => {
			const watcher = watch(this.base_dir, {}, async () => {
				if (!is_building) {
					is_building = true;
					last_build = await this.build();
					if (serv && this.build_options.server.hot_reload) {
						serv.hr_state.version += 1;
						serv.ssock.emit('reload');
					}
					is_building = false;
				}
			});
			console.log(`WATCH\t${path.resolve(__dirname, this.base_dir)}`);
			return watcher;
		};

		// server
		const server_state: ServerState | undefined = this.build_options?.server
			? (() => {
					// server state
					const local_state: ServerState = {
						server: http.createServer((req, res) => {
							const url = new URL(req.url, `http://${req.headers.host}`);

							const target_path =
								url.pathname == '/' ? `${this.name}.html` : path.join(this.base_dir, req.url);

							const content_type = dum_mime_type(path.extname(target_path).toLowerCase());
							fs.readFile(target_path, (err, data) => {
								if (err) {
									// If the file is not found, send a 404 response
									console.log(`SERVE\t${content_type}\t404\t${url.toString()}`);
									res.writeHead(404, { 'Content-Type': 'text/plain' });
									res.end('File not found');
								} else {
									console.log(`SERVE\t${content_type}\t200\t${url.toString()}`);
									res.writeHead(200, { 'Content-Type': content_type });
									res.end(data);
								}
							});
						}),
					};

					if (this.build_options.server.hot_reload) {
						local_state.hr_state = {
							session: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
							version: 0,
						};

						local_state.ssock = new socketio.Server(local_state.server);
						local_state.ssock.on('connection', (sock) => {
							sock.on('polling', (session, version) => {
								if (
									!(
										session == local_state.hr_state.session &&
										version == local_state.hr_state.version
									)
								)
									sock.emit('reload');
							});

							sock.emit('init', local_state.hr_state.session, local_state.hr_state.version);
						});
					}

					// server listen
					local_state.server.listen(
						this.build_options.server.port,
						this.build_options.server.hostname,
						() => {
							console.log(
								`SERVE\thttp://${this.build_options.server.hostname}:${this.build_options.server.port}/\n`
							);
						}
					);
					return local_state;
				})()
			: undefined;

		// watcher w/ no state
		if (this.build_options?.watcher) {
			init_watcher(server_state);
			console.log(`HR\t${this.build_options?.server?.hot_reload ? 'enabled' : 'disabled'}`);
		}

		return last_build;
	}
}
