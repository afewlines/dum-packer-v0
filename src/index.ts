import * as fs from 'fs';
import * as dt from 'dependency-tree';
import minify from 'html-minifier-terser';
import * as jsdom from 'jsdom';
import watch from 'node-watch';
import * as http from 'node:http';
import * as path from 'path';
import * as pug from 'pug';
import * as sass from 'sass';
import * as socketio from 'socket.io';
import * as ts from 'typescript';

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 5174;

const IMEX_IMPORT_REGEX =
	/^\s*import\s+(?:(?:\{(?<named>.+)})|(?:\*\s+as\s+(?<namespace>\w+)))\s+from\s+['"](?<source>.+)['"]\s*;/i;
const IMEX_EXPORT_REGEX =
	/^export\s+(?:(?:(?:async)|(?:function)|(?:interface)|(?:class)|(?:enum)|(?:const)|(?:var))\s+)+(?<name>\w+)/i;

const IMEX_RAW = fs.readFileSync(path.resolve(__dirname, 'imex_client.js'), {}).toString();
const HOT_RELOAD_RAW = fs
	.readFileSync(path.resolve(__dirname, 'hot_reload_client.js'), {})
	.toString();

export interface ScopelessImportMap {
	[import_name: string]: string;
}
export interface DumPackerBuildOpts {
	/** should project be minified */
	minify?: boolean;

	/** hot reload/watch leave empty to disable */
	hot_reload?: {
		hostname?: string;
		port?: number;
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
	template: string;
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
/** remove extension from path */
function strip_ext(target: string): string {
	return target.replace(/\.[^/.]+$/, '');
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
	template: string;
	style?: string[];
	code?: string[];
	import_map?: ScopelessImportMap;
	build_options?: DumPackerBuildOpts;
	constructor(opts: DumPackerProjectOpts) {
		this.base_dir = path.relative('.', opts.base_dir);
		this.name = opts.name;
		this.template = path.relative('.', opts.template);

		this.style = typeof opts.style === 'string' ? [opts.style] : opts.style;
		if (this.style) {
			this.style.reverse();
			this.style = this.style.map((s) => path.relative('.', s));
		}

		this.code = typeof opts.code === 'string' ? [opts.code] : opts.code;
		if (this.code) {
			this.code.reverse();
			this.code = this.code.map((c) => path.relative('.', c));
		}

		this.import_map = opts.import_map;

		this.build_options = Object.assign({}, opts.build_options);
		if (this.build_options.hot_reload) {
			this.build_options.hot_reload = Object.assign(
				{ hostname: DEFAULT_HOST, port: DEFAULT_PORT },
				this.build_options.hot_reload
			);
		}
	}

	private translate_code(source_file: string): string | undefined {
		source_file = path.join(this.base_dir, source_file);
		const source = fs.readFileSync(source_file, { encoding: 'utf-8' });
		const ext = path.extname(source_file).toLocaleLowerCase();
		const name = path.basename(source_file, path.extname(source_file));

		// transpile code
		let code_js: string = (() => {
			switch (ext) {
				case '.ts':
					return ts.transpileModule(source, {
						moduleName: name,
						compilerOptions: {
							target: ts.ScriptTarget.ESNext,
							module: ts.ModuleKind.ESNext,
						},
					}).outputText;

				default:
					return source;
			}
		})();

		const source_lines = code_js.split('\n');
		const import_lines = [];
		const output_lines = [];
		const export_lines = [];

		for (let i = 0; i < source_lines.length; ++i) {
			const line = source_lines[i];
			const import_match = IMEX_IMPORT_REGEX.exec(line);
			const export_match = IMEX_EXPORT_REGEX.exec(line);
			const bad_match = /^\s*export\s+{\W*}/i.exec(line);

			if (bad_match) continue;
			if (import_match && import_match.groups) {
				// line is import, figure out import source and add to deps

				let isource: string = import_match.groups.source.trim();
				if (this.import_map && isource in this.import_map) {
					// cdn/import map check
					import_lines.push(line);
					continue;
				}

				if (isource.startsWith('.')) isource = path.dirname(source_file) + isource.slice(1);
				isource = strip_ext(path.relative(this.base_dir, isource));
				if (isource.length < 1) {
					console.warn(`Bad source: [${i}] '${line}'`);
					continue;
				}

				if (import_match.groups.namespace) {
					// import * as example from 'example.ts'
					const ns = import_match.groups.namespace.trim();
					const reline = `const ${ns} = __dum_import('${isource}');`;
					output_lines.push(reline);
				} else if (import_match.groups.named) {
					// import {test1, test2 as other_test} from 'example.ts'
					for (const named of import_match.groups.named.trim().split(',')) {
						const t = named.trim();
						const as_match = /(?<key>\S*)\s+as\s+(?<tform>\S*)/i.exec(t);
						let reline: string;
						if (as_match && as_match.groups) {
							reline = `const ${as_match.groups.tform} = __dum_import('${isource}', '${as_match.groups.key}');`;
						} else {
							reline = `const ${t} = __dum_import('${isource}', '${t}');`;
						}
						output_lines.push(reline);
					}
				}
			} else if (export_match && export_match.groups) {
				// aaaaand exports
				const ne = export_match.groups.name.trim();
				const ename = strip_ext(path.relative(this.base_dir, source_file));
				const nline = `__dum_export('${ename}', '${ne}', ${ne});`;
				export_lines.push(nline);

				output_lines.push(line.replace(/^\s*export\s+/i, ''));
			} else {
				output_lines.push(line);
			}
		}

		code_js = (output_lines.join('\n') + export_lines.join('\n')).trim();

		if (code_js.length) {
			return `${import_lines.join('\n')}\n(()=>{\n${code_js}\n})();`.trim();
		} else return undefined;
	}
	private process_code(dom: jsdom.JSDOM) {
		if (this.code == undefined) return;

		// find dependencies list
		const dep_list = new SetList<string>();
		const unresolved = new SetList<string>();
		for (const entry_point of this.code) {
			const nexistent = [];
			dep_list.push(
				...dt
					.toList({
						directory: this.base_dir,
						filename: path.join(this.base_dir, entry_point),
						noTypeDefinitions: true,
						nonExistent: nexistent,
						filter: (path) => path.indexOf('node_modules') === -1,
					})
					.map((v) => path.relative(this.base_dir, v))
			);
			unresolved.push(...nexistent);
		}

		for (const source_file of dep_list.reverse()) {
			const code_result = this.translate_code(source_file);
			if (code_result == undefined) continue;

			dom_prepend_child(
				dom.window.document.body,
				(() => {
					const bucket = dom.window.document.createElement('script');
					bucket.id = `dum_code_${source_file}`;
					bucket.innerHTML = `\n${code_result}\n`;
					bucket.type = 'module';
					return bucket;
				})()
			);
		}

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

		// import map
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
		console.log(`BUILD START\tProject: '${this.name}'`);

		// create new pseudo-dom from html
		const dom = new jsdom.JSDOM(
			(() => {
				const raw = fs.readFileSync(path.join(this.base_dir, this.template), { encoding: 'utf-8' });
				if (path.extname(this.template).toLowerCase() == '.pug') {
					return pug
						.compile(raw, {
							pretty: true,
						})()
						.replace(new RegExp(/\t/g), '');
				} else return raw;
			})()
		);

		// do styles
		if (this.style) {
			for (const style of this.style) {
				// append style bucket to head
				dom_append_child(
					dom.window.document.head,
					(() => {
						// read scss/sass, compile
						const style_string = (() => {
							let res = fs.readFileSync(path.join(this.base_dir, style), { encoding: 'utf-8' });
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

		// do code
		this.process_code(dom);

		// do hot reload
		if (this.build_options?.hot_reload) {
			// get server's socket io
			dom_append_child(
				dom.window.document.head,
				(() => {
					const bucket = dom.window.document.createElement('script');
					bucket.src = `http://${this.build_options.hot_reload.hostname}:${this.build_options.hot_reload.port}/socket.io/socket.io.js`;
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
						HOT_RELOAD_RAW.replace('$HOST', this.build_options.hot_reload.hostname)
							.replace('$PORT', `${this.build_options.hot_reload.port}`)
							.trim() +
						'\n';
					return bucket;
				})()
			);
		}

		// rasterize dom
		let html_string = dom.serialize();
		const html_file = `${this.name}.html`;

		// minimize
		if (this.build_options?.minify) {
			html_string = await minify.minify(html_string, {
				removeComments: true,
				collapseBooleanAttributes: true,
				collapseWhitespace: true,
				collapseInlineTagWhitespace: true,
				minifyCSS: true,
				minifyJS: true,
				noNewlinesBeforeTagClose: true,
				sortAttributes: true,
			});
		}

		fs.writeFileSync(html_file, html_string);
		console.log(`BUILD DONE\t'${html_file}' (${html_string.length / 1024}kb)`);
		return html_string;
	}

	async run() {
		let last_build = await this.build();
		if (this.build_options?.hot_reload) {
			let is_building: boolean = false;
			const stat = {
				session: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
				version: 0,
			};

			// server
			const server = http.createServer((req, res) => {
				const url = new URL(req.url, `http://${req.headers.host}`);

				const target_path =
					url.pathname == '/' ? `${this.name}.html` : path.join(this.base_dir, req.url);

				const content_type = dum_mime_type(path.extname(target_path).toLowerCase());
				fs.readFile(target_path, (err, data) => {
					if (err) {
						// If the file is not found, send a 404 response
						console.log(`SERVER\t${content_type}\t404\t${url.toString()}`);
						res.writeHead(404, { 'Content-Type': 'text/plain' });
						res.end('File not found');
					} else {
						console.log(`SERVER\t${content_type}\t200\t${url.toString()}`);
						res.writeHead(200, { 'Content-Type': content_type });
						res.end(data);
					}
				});
			});

			const ssock = new socketio.Server(server);
			ssock.on('connection', (sock) => {
				sock.on('polling', (session, version) => {
					if (!(session == stat.session && version == stat.version)) sock.emit('reload');
				});

				sock.emit('init', stat.session, stat.version);
			});

			// watcher
			const _watcher = watch(this.base_dir, {}, async () => {
				if (!is_building) {
					is_building = true;
					last_build = await this.build();
					stat.version += 1;
					ssock.emit('reload');
					is_building = false;
				}
			});
			console.log(`WATCH\t${this.base_dir}`);

			server.listen(
				this.build_options.hot_reload.port,
				this.build_options.hot_reload.hostname,
				() => {
					console.log(
						`\nServer running at http://${this.build_options.hot_reload.hostname}:${this.build_options.hot_reload.port}/\n`
					);
				}
			);
		}

		return last_build;
	}
}
