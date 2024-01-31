import fs from 'fs';
import dt from 'dependency-tree';
import minify from 'html-minifier-terser';
import * as jsdom from 'jsdom';
import mime from 'mime';
import watch from 'node-watch';
import * as http from 'node:http';
import path from 'path';
import * as pug from 'pug';
import * as sass from 'sass';
import * as socketio from 'socket.io';
import ts from 'typescript';

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 5174;

const IMEX_IMPORT_REGEX =
	/^\s*import\s+(?:(?:\{(?<named>.+)})|(?:\*\s+as\s+(?<namespace>\w+)))\s+from\s+['"](?<source>.+)['"]\s*;/i;
const IMEX_EXPORT_REGEX =
	/^export\s+(?:(?:(?:async)|(?:function)|(?:interface)|(?:class)|(?:enum)|(?:const)|(?:var))\s+)+(?<name>\w+)/i;
const IMEX_RAW = `
const __dum_scope = {};

function __dum_export(m, k, value) {
    if (!(m in __dum_scope)) __dum_scope[m] = {};
    if (k in __dum_scope[m]) throw \`Exported item '\${k}' in module '\${m}' already exists\`;
    __dum_scope[m][k] = value;
}

function __dum_import(m, k) {
    if (m in __dum_scope) {
        if (k) {
            if (k in __dum_scope[m]) return __dum_scope[m][k];
            throw \`Cannot import item '\${k}' from module '\${m}'\`;
        }
        return __dum_scope[m];
    }
    throw \`Cannot import module '\${m}'\`;
}`;
const HOT_RELOAD_RAW = `
const socket = io('http://$HOST:$PORT');
const stat = { session: -1, version: -1 };

socket.on('init', (session, version) => {
    console.log('Connected to HR Server');
    stat.session = session;
    stat.version = version;
    console.log(\`HR#\${stat.session}.\${stat.version}\`);
});

socket.on('reload', () => window.location.reload());

setInterval(() => {
    socket.emit('polling', stat.session, stat.version);
}, 5000);
`;

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

	/** target html page
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
	/** import map for CDN */
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
console.log(SetList);

/** dum loader Project class */
export class DumPackerProject implements DumPackerProjectOpts {
	name: string;
	base_dir: string;
	page: string;
	style?: string[];
	code?: string[];
	import_map?: ScopelessImportMap;
	build_options?: DumPackerBuildOpts;
	constructor(opts: DumPackerProjectOpts) {
		this.base_dir = path.relative('.', opts.base_dir);
		this.name = opts.name;
		this.page = path.relative('.', opts.page);

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

	private dom_prepend_child(parent: HTMLElement, child: HTMLElement): HTMLElement {
		return parent.insertBefore(child, parent.children[0]);
	}
	private dom_append_child(parent: HTMLElement, child: HTMLElement): HTMLElement {
		return parent.appendChild(child);
	}

	private translate_code(source_file: string): string | undefined {
		source_file = path.join(this.base_dir, source_file);
		const source = fs.readFileSync(source_file, { encoding: 'utf-8' });
		const ext = path.extname(source_file).toLocaleLowerCase();
		const name = path.basename(source_file, path.extname(source_file));
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
		const output_lines = [];
		const export_lines = [];

		for (let i = 0; i < source_lines.length; ++i) {
			const line = source_lines[i];
			const import_match = IMEX_IMPORT_REGEX.exec(line);
			const export_match = IMEX_EXPORT_REGEX.exec(line);
			const bad_match = /^\s*export\s+{\W*}/i.exec(line);
			// console.log(i, import_match, export_match, bad_match, line);

			if (bad_match) continue;
			if (import_match && import_match.groups) {
				// line is import, figure out import source and add to deps
				let isource: string = import_match.groups.source.trim();
				if (isource.startsWith('.')) isource = path.dirname(source_file) + isource.slice(1);
				isource = path.relative(this.base_dir, isource);
				const iext = /^(.+)(?:(?=[.]))/i.exec(isource);
				if (iext) {
					console.log(isource, iext[1]);
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
				const nline = `__dum_export('${path.relative(this.base_dir, source_file)}', '${ne}', ${ne});`;
				output_lines.push(line.replace(/^\s*export\s+/i, ''));
				export_lines.push(nline);
			} else {
				output_lines.push(line);
			}
		}

		code_js = (output_lines.join('\n') + export_lines.join('\n')).trim();
		console.log(source_file, code_js.length);
		return code_js.length ? `(()=>{\n${code_js}\n})();` : undefined;
	}
	private process_code() {
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
		console.log(dep_list, unresolved);
	}

	public async build(): Promise<string> {
		console.log(`Building Project '${this.name}'`);

		// create new pseudo-dom from html
		const dom = new jsdom.JSDOM(
			(() => {
				const raw = fs.readFileSync(path.join(this.base_dir, this.page), { encoding: 'utf-8' });
				if (path.extname(this.page).toLowerCase() == '.pug') {
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
				dom.window.document.head.appendChild(
					(() => {
						// read scss/sass, compile
						const style_string = (() => {
							let res = fs.readFileSync(path.join(this.base_dir, style), { encoding: 'utf-8' });
							switch (path.extname(style).toLocaleLowerCase()) {
								case '.scss':
								case '.sass':
									res = sass.compileString(res, {}).css.trim();
									if (this.build_options.minify) {
										res = res.replace(new RegExp(/(?:\s?{\s*)/, 'g'), '{ ');
										res = res.replace(new RegExp(/(?:}\s*)/, 'g'), '} ');
										res = res.replace(new RegExp(/(?:;\s*)/, 'g'), '; ');
									}
									break;

								default:
									break;
							}
							return res.trim();
						})();

						// create style bucket, fill
						const bucket = dom.window.document.createElement('style');
						bucket.innerHTML = `\n${style_string}\n`;
						return bucket;
					})()
				);
			}
		}

		// do code
		if (this.code) {
			const dependencies = [];
			for (const code of this.code) {
				dt.toList({
					directory: this.base_dir,
					filename: path.join(this.base_dir, code),
					noTypeDefinitions: true,
				}).map((v) => {
					const dep = path.relative(this.base_dir, v);
					if (!dependencies.includes(dep)) dependencies.push(dep);
				});
			}
			console.log(dependencies, this.process_code());

			for (const code of dependencies.reverse()) {
				const code_result = this.translate_code(code);
				if (code_result == undefined) continue;
				const bucket = dom.window.document.createElement('script');
				bucket.innerHTML = '\n' + code_result.trim() + '\n';
				bucket.type = 'module';
				bucket.id = code;
				dom.window.document.body.insertBefore(bucket, dom.window.document.body.children[0]);
			}
		}
		// dum modules
		dom.window.document.body.insertBefore(
			(() => {
				// create code bucket, fill
				const bucket = dom.window.document.createElement('script');
				bucket.innerHTML = '\n' + IMEX_RAW.trim() + '\n';
				return bucket;
			})(),
			dom.window.document.body.children[0]
		);
		// import map
		if (this.import_map) {
			const bucket = dom.window.document.createElement('script');
			bucket.type = 'importmap';
			bucket.innerHTML = `\n${JSON.stringify({ imports: this.import_map }, undefined, '\t')}\n`;
			dom.window.document.body.insertBefore(bucket, dom.window.document.body.children[0]);
		}
		// hot reload
		if (this.build_options?.hot_reload) {
			dom.window.document.head.appendChild(
				(() => {
					const bucket = dom.window.document.createElement('script');
					bucket.src = `http://${this.build_options.hot_reload.hostname}:${this.build_options.hot_reload.port}/socket.io/socket.io.js`;
					return bucket;
				})()
			);

			dom.window.document.body.insertBefore(
				(() => {
					const bucket = dom.window.document.createElement('script');
					bucket.innerHTML =
						'\n' +
						HOT_RELOAD_RAW.replace('$HOST', this.build_options.hot_reload.hostname)
							.replace('$PORT', `${this.build_options.hot_reload.port}`)
							.trim() +
						'\n';
					return bucket;
				})(),
				dom.window.document.body.children[0]
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
		console.log(`File '${html_file}' Built (${html_string.length / 1024}kb)`);
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

				const content_type = mime.getType(req.url) || 'text/plain';
				console.log(`REQUEST\t${url.toString()}\t(${content_type})`);

				if (url.pathname == '/') {
					res.writeHead(200, { 'Content-Type': 'text/html' });
					res.end(last_build);
				} else {
					const target_path = path.join(this.base_dir, req.url);
					fs.readFile(target_path, (err, data) => {
						if (err) {
							// If the file is not found, send a 404 response
							res.writeHead(404, { 'Content-Type': 'text/plain' });
							res.end('File not found');
						} else {
							res.writeHead(200, { 'Content-Type': content_type });
							res.end(data);
						}
					});
				}
			});

			const ssock = new socketio.Server(server);
			ssock.on('connection', (sock) => {
				sock.on('polling', (session, version) => {
					if (!(session == stat.session && version == stat.version)) sock.emit('reload');
				});

				sock.emit('init', stat.session, stat.version);
			});

			// watcher
			const _watcher = watch.default(this.base_dir, {}, async () => {
				if (!is_building) {
					is_building = true;
					last_build = await this.build();
					stat.version += 1;
					ssock.emit('reload');
					is_building = false;
				}
			});
			console.log('Watching...');

			server.listen(
				this.build_options.hot_reload.port,
				this.build_options.hot_reload.hostname,
				() => {
					console.log(
						`Server running at http://${this.build_options.hot_reload.hostname}:${this.build_options.hot_reload.port}/\n`
					);
				}
			);
		}

		return last_build;
	}
}
