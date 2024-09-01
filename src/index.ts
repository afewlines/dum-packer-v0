import * as dt from 'dependency-tree';
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as minify from 'html-minifier-terser';
import * as jsdom from 'jsdom';
import watch from 'node-watch';
import * as http from 'node:http';
import * as path from 'path';
import * as prettier from 'prettier';
import * as pug from 'pug';
import * as sass from 'sass';
import * as socketio from 'socket.io';
import ts from 'typescript';

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 5174;

import HOT_RELOAD_RAW from '../public/hot_reload_client.template.js';
import IMEX_RAW from '../public/imex_client.template.js';

interface HRState {
	session: number;
	version: number;
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

// for hooks that return a boolean, false stops standard execution

interface DumPackerProjectHooks {
	build_start?: () => Promise<boolean>;
	build_done?: () => Promise<void>;

	on_watch?: (event: 'update' | 'remove', file_path: string) => Promise<boolean>;
	on_serve?: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean | string>;
	on_rasterize?: (dom: jsdom.JSDOM) => Promise<boolean>;

	/**
	 * hook for processing page
	 * @async
	 * @param {DumPackerProject} proj Project object
	 * @param {string} ext File extension of project's page
	 * @param {string} data Page file's data
	 * @returns {Promise<undefined|string>} undefined doesn't affect page, string used as final page
	 */
	process_page?: (ext: string, data: string) => Promise<undefined | string>;
	process_style?: (path: string) => Promise<undefined | string | boolean>;
	process_code?: (export_module: string, path: string) => Promise<undefined | string | boolean>;
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

	disable_imex?: boolean;

	/** hooks function */
	project_hooks?: DumPackerProjectHooks;
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
/** get module source relative to base dir
 * @param base_dir string/path: base directory of project
 * @param requester string/path: source file that is importing/exporting
 * @param module_source string/path: normalized path to module from source file
 * @returns string: module path relative to base dir, '/' path separators, no file extension
 */
function clean_module_source(base_dir: string, requester: string, module_source: string): string {
	let new_path = path.resolve(path.dirname(requester), module_source).replace(/\.[^/.]+$/, '');
	new_path = path.relative(base_dir, new_path);
	if (path.basename(new_path).toLowerCase() == 'index') new_path = path.dirname(new_path);
	new_path = new_path.replaceAll(path.win32.sep, '/');

	return new_path;
}
/** return optional promise as a promise */
async function await_or_undefined<R>(target: undefined | Promise<R>): Promise<undefined | R> {
	if (target === undefined) return undefined;
	return await target;
}

// transformers
/** Look for immediate child of {@link parent} of kind {@link target_kind}.
 * @param source_file - {@link ts.SourceFile} that holds {@link parent}
 * @param parent - node to query children of
 * @param target_kind - {@link ts.SyntaxKind} of node to search for
 * @returns node if found, else underfined
 */
function query_children<R extends ts.Node = ts.Node>(
	source_file: ts.SourceFile,
	parent: ts.Node,
	target_kind: ts.SyntaxKind
): R | undefined {
	for (const child of parent.getChildren(source_file)) {
		if (child.kind === target_kind) return child as R;
	}
}
/** Collect all descendants of {@link node} of kind {@link target_kind}.
 * @param source_file - {@link ts.SourceFile} that holds {@link node}
 * @param node - node to begin search from
 * @param target_kind - {@link ts.SyntaxKind} of node to search for
 * @returns array of found nodes
 * @remarks Recursive
 */
function query_all<R extends ts.Node = ts.Node>(
	source_file: ts.SourceFile,
	node: ts.Node,
	target_kind: ts.SyntaxKind,
	include_root: boolean = true
): R[] {
	const result: R[] = include_root && node.kind === target_kind ? [node as R] : [];

	for (const child of node.getChildren(source_file)) {
		result.push(...query_all<R>(source_file, child, target_kind, true));
	}

	return result;
}
/** Transform target source file to dum imex format */
function do_imex_transform(
	base_dir: string,
	import_map: ScopelessImportMap | undefined,
	source_path: string,
	source_file: ts.SourceFile
) {
	const source_lines = source_file.text.split('\n');

	const export_calls: ts.Expression[] = [];
	const import_calls: ts.VariableDeclarationList[] = [];
	const real_imports: ts.ImportDeclaration[] = [];

	const this_module = source_path;

	function transformer_imex<T extends ts.Node>(
		context: ts.TransformationContext
	): ts.Transformer<T> {
		const id_scope = context.factory.createIdentifier('__dum_scope');
		const id_export = context.factory.createIdentifier('__dum_export');
		const id_import = context.factory.createIdentifier('__dum_import');

		function clean(target: string): string {
			const quote_match = /^\s*['"`](?<data>.*)['"`]\s*$/gm.exec(target);
			if (quote_match && quote_match.groups) target = quote_match.groups.data;
			return target;
		}
		function make_export(m: string, k: string | ts.Identifier, target: string | ts.Expression) {
			// console.log('export', m, k);

			return context.factory.createCallExpression(id_export, undefined, [
				context.factory.createStringLiteral(
					clean_module_source(base_dir, source_path, path.normalize(clean(m)))
				),
				typeof k === 'string' ? context.factory.createStringLiteral(clean(k)) : k,
				typeof target === 'string' ? context.factory.createIdentifier(target) : target,
			]);
		}
		function make_import(m: string, k?: string): ts.CallExpression;
		function make_import(m: string, k?: string, target?: string): ts.VariableDeclarationList;
		function make_import(m: string, k?: string, target?: string) {
			// console.log('import', m, k, target);

			const args: ts.Expression[] = [
				context.factory.createStringLiteral(
					clean_module_source(base_dir, source_path, path.normalize(clean(m)))
				),
			];
			if (k) args.push(context.factory.createStringLiteral(clean(k)));

			const call = context.factory.createCallExpression(id_import, undefined, args);
			if (target)
				return context.factory.createVariableDeclarationList(
					[context.factory.createVariableDeclaration(target, undefined, undefined, call)],
					ts.NodeFlags.Const
				);

			return call;
		}
		function make_eximport(m: string, k: ts.Identifier, ref: ts.ModuleReference) {
			// console.log('eximport', m, k);

			return context.factory.createCallExpression(id_export, undefined, [
				context.factory.createStringLiteral(
					clean_module_source(base_dir, source_path, path.normalize(clean(m)))
				),
				k,
				ts.isExternalModuleReference(ref)
					? ref.expression
					: context.factory.createIdentifier(ref.getText(source_file)),
			]);
		}
		function make_expose(m: string, source: string) {
			// console.log('expose', m, source);

			return context.factory.createCallExpression(
				context.factory.createPropertyAccessExpression(
					context.factory.createIdentifier('Object'),
					context.factory.createIdentifier('assign')
				),
				undefined,
				[
					context.factory.createElementAccessExpression(
						id_scope,
						context.factory.createStringLiteral(
							clean_module_source(base_dir, source_path, path.normalize(clean(m)))
						)
					),
					context.factory.createElementAccessExpression(
						id_scope,
						context.factory.createStringLiteral(clean(source))
					),
				]
			);
		}

		// the visitor
		function visit(node: ts.Node): ts.Node | undefined {
			const node_line =
				source_lines[source_file.getLineAndCharacterOfPosition(node.getStart(source_file)).line];

			// omits and ignores
			// omit omit lines, ignore ignores
			if (!ts.isSourceFile(node)) {
				if (/__dum_omit/.exec(node_line)) return undefined;
				if (/__dum_ignore/.exec(node_line)) return node;
			}

			// export import
			if (ts.isImportEqualsDeclaration(node)) {
				export_calls.push(make_eximport(this_module, node.name, node.moduleReference));
				return undefined;
			}
			// standard export, agg export
			if (ts.isExportDeclaration(node)) {
				if (node.moduleSpecifier) {
					// RE-EXPORT
					const export_module = node.moduleSpecifier.getText(source_file);

					// process named
					const named_node = query_children(source_file, node, ts.SyntaxKind.NamedExports);
					if (named_node) {
						for (const spec of query_all(source_file, named_node, ts.SyntaxKind.ExportSpecifier)) {
							// spec satisfies ts.ExportSpecifier;
							const old_name = (spec as ts.ExportSpecifier).propertyName?.getText(source_file);
							const name = (spec as ts.ExportSpecifier).name.getText(source_file);
							export_calls.push(
								make_export(this_module, name, make_import(export_module, old_name || name))
							);
						}
					}

					// process namespace
					const namespace_node = query_children(source_file, node, ts.SyntaxKind.NamespaceExport);
					if (namespace_node) {
						const id = query_children(source_file, namespace_node, ts.SyntaxKind.Identifier);
						if (id)
							export_calls.push(
								make_export(this_module, id.getText(source_file), make_import(export_module))
							);
					}

					if (!(named_node || namespace_node)) {
						// alias-less namespace export
						export_calls.push(make_expose(this_module, export_module));
					}
				} else {
					// NORMAL EXPORT
					const named_node = query_children(source_file, node, ts.SyntaxKind.NamedExports);
					if (named_node) {
						for (const spec of query_all(source_file, named_node, ts.SyntaxKind.ExportSpecifier)) {
							const old_name = (spec as ts.ExportSpecifier).propertyName?.getText(source_file);
							const name = (spec as ts.ExportSpecifier).name.getText(source_file);

							export_calls.push(make_export(this_module, name, old_name || name));
						}
					}
				}
				return undefined;
			}

			// modifier export
			const mods = ts.getModifiers(node as ts.HasModifiers);
			if (mods && mods.some((v) => v.kind === ts.SyntaxKind.ExportKeyword)) {
				const id = query_children(source_file, node, ts.SyntaxKind.Identifier)?.getText(
					source_file
				);

				if (id) export_calls.push(make_export(this_module, id, id));
				else if (ts.isVariableStatement(node)) {
					// i wonder what else might fall through the cracks...
					// if you see something that doesn't get picked up by IMEX but has
					// the 'export' keyword removed, let me know
					for (const dec of node.declarationList.declarations) {
						export_calls.push(
							make_export(this_module, dec.name.getText(source_file), dec.name as ts.Identifier)
						);
					}
					// return undefined; // dont omit :)
				}
				return context.factory.replaceModifiers(
					node as ts.HasModifiers,
					mods.filter((m) => !(m.kind === ts.SyntaxKind.ExportKeyword))
				);
			}

			// standard import
			if (ts.isImportDeclaration(node)) {
				const import_module = node.moduleSpecifier.getText(source_file);

				// check import map
				if (import_map && clean(import_module) in import_map) {
					real_imports.push(node);
					return undefined;
				}

				if (node.importClause) {
					// process named
					const named_node = query_children(
						source_file,
						node.importClause,
						ts.SyntaxKind.NamedImports
					);
					if (named_node) {
						for (const spec of query_all(source_file, named_node, ts.SyntaxKind.ImportSpecifier)) {
							const old_name = (spec as ts.ImportSpecifier).propertyName?.getText(source_file);
							const name = (spec as ts.ImportSpecifier).name.getText(source_file);
							import_calls.push(make_import(import_module, name, old_name || name));
						}
					}

					// process namespace
					const namespace_node = query_children(
						source_file,
						node.importClause,
						ts.SyntaxKind.NamespaceImport
					);
					if (namespace_node) {
						const id = query_children(source_file, namespace_node, ts.SyntaxKind.Identifier);
						if (id)
							import_calls.push(make_import(import_module, undefined, id.getText(source_file)));
					}
				} else {
					// side effect, ignore because bundle
				}
				return undefined;
			}

			return ts.visitEachChild(node, visit, context);
		}

		return (node) => ts.visitNode(node, visit) as T;
	}

	const xform = ts.transform(source_file, [transformer_imex]);
	let new_source = xform.transformed[0] as ts.SourceFile;

	if (new_source.text.trim().length < 1) return undefined;

	// closure it
	new_source = ts.factory.updateSourceFile(new_source, [
		...real_imports,
		ts.factory.createExpressionStatement(
			ts.factory.createCallExpression(
				ts.factory.createArrowFunction(
					undefined,
					undefined,
					[],
					undefined,
					ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
					ts.factory.createBlock(
						[
							...import_calls.map((c) => ts.factory.createVariableStatement([], c)),
							...new_source.statements,
							...export_calls.map((c) => ts.factory.createExpressionStatement(c)),
						],
						true
					)
				),
				[],
				[]
			)
		),
	]);
	return new_source;
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
	hooks: DumPackerProjectHooks;
	disable_imex: boolean;
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

		this.disable_imex = opts.disable_imex ?? false;

		this.hooks = opts.project_hooks ?? {};
	}

	// template
	private async process_template() {
		const raw = fs.readFileSync(this.page, { encoding: 'utf-8' });
		const extname = path.extname(this.page).toLowerCase();
		let res: string | undefined;
		if (
			this.hooks.process_page &&
			(res = await await_or_undefined(this.hooks.process_page?.(extname, raw))) !== undefined
		) {
			return res;
		}
		switch (extname) {
			case '.pug':
				res = pug
					.compile(raw, {
						pretty: true,
					})()
					.replace(new RegExp(/\t/g), '');
				break;

			case '.html':
			default:
				res = raw;
				break;
		}
		return res;
	}

	// style
	private async process_style(dom: jsdom.JSDOM) {
		if (this.style === undefined) return;
		for (const style of this.style) {
			// get data and fire hook
			// if hook returns false, cancel style
			// if hook returns string, replace data
			// if hook returns undefined, read data
			let hooked: string | undefined | boolean = undefined;
			let data: string;
			hooked = await await_or_undefined(this.hooks.process_style?.(style));
			if (hooked === false) {
				console.log(`BUILD\tcancelled style '${style}'`);
				continue;
			} else if (typeof hooked === 'string') data = hooked;
			else data = fs.readFileSync(style, { encoding: 'utf-8' });

			// append style bucket to head
			dom.window.document.head.appendChild(
				(() => {
					// read scss/sass, compile
					// if hook returned string, use raw data
					// if hook returned undefined, process data
					const style_string =
						hooked === undefined
							? (() => {
									let res: string = data;
									const opts: sass.StringOptions<'sync'> = {
										style: this.build_options.minify ? 'compressed' : 'expanded',
										syntax: 'scss',
										url: new URL(`file://${path.resolve(style)}`),
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
								})()
							: data;

					// create style bucket, fill
					const bucket = dom.window.document.createElement('style');

					bucket.setAttribute('__dum_style', clean_module_source(this.base_dir, '', style));

					bucket.innerHTML = `\n${style_string}\n`;
					return bucket;
				})()
			);
		}
	}

	// code
	private async translate_code(source_path: string): Promise<string | undefined> {
		// get source file as path and module name
		source_path = path.normalize(source_path);
		const export_module = clean_module_source(
			this.base_dir,
			source_path,
			path.basename(source_path)
		);

		// if hook returns false, cancel style
		// if hook returns string, replace data
		// if hook returns undefined, read data
		let hooked: string | undefined | boolean = undefined;
		let data: string;
		hooked = await await_or_undefined(this.hooks.process_code?.(export_module, source_path));
		if (hooked === false) {
			console.log(`BUILD\tcancelled code '${source_path}'`);
			return undefined;
		} else if (typeof hooked === 'string') data = hooked;
		else data = fs.readFileSync(source_path, { encoding: 'utf-8' });

		// transpile code
		// if hook returned string, skip transpile
		// if hook returned undefined, transpile data
		const code_js: string =
			hooked === undefined
				? (() => {
						const raw = data;
						const ext = path.extname(source_path).toLocaleLowerCase();
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
					})()
				: data;

		if (this.disable_imex) return code_js;

		// process imex transform
		const new_source = do_imex_transform(
			this.base_dir,
			this.import_map,
			source_path,
			ts.createSourceFile(source_path, code_js, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)
		);

		if (new_source === undefined) throw new Error(`Translation error: ${source_path}`);
		const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
		return printer.printNode(ts.EmitHint.Unspecified, new_source, new_source);
	}
	private async process_code(dom: jsdom.JSDOM) {
		// add import map to dom
		if (this.import_map) {
			dom.window.document.body.appendChild(
				(() => {
					const bucket = dom.window.document.createElement('script');
					bucket.setAttribute('__dum_code', 'IMPORT_MAP');
					bucket.type = 'importmap';
					bucket.innerHTML = `\n${JSON.stringify({ imports: this.import_map }, undefined, this.build_options.minify ? undefined : 4)}\n`;
					return bucket;
				})()
			);
		}

		if (this.code == undefined) return;

		// add dum module (IMEX) code to dom
		if (!this.disable_imex)
			dom.window.document.body.appendChild(
				(() => {
					const bucket = dom.window.document.createElement('script');
					bucket.setAttribute('__dum_code', 'IMEX');
					bucket.innerHTML = `\n${IMEX_RAW}\n`;
					// bucket.type = 'module';
					return bucket;
				})()
			);

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
		for (const source_file of dep_list) {
			// translate the code
			let code_result = await this.translate_code(source_file);

			// if skippable (.ts files only exporting types)
			if (code_result == undefined) continue;

			// do code specific minify
			if (this.build_options.minify) {
				code_result = (await esbuild.transform(code_result, { minify: true })).code;
			}

			// add modularized code to dom
			// dom_prepend_child(
			dom.window.document.body.appendChild(
				(() => {
					const bucket = dom.window.document.createElement('script');
					bucket.type = 'module';

					//
					bucket.setAttribute('__dum_module', clean_module_source(this.base_dir, '', source_file));
					bucket.setAttribute('__dum_module_source', path.relative(this.base_dir, source_file));

					//
					bucket.innerHTML = `\n${code_result}\n`;
					return bucket;
				})()
			);
		}
	}

	public async build(): Promise<string> {
		console.log(`BUILD\tstarting\t'${this.name}'`);
		if ((await await_or_undefined(this.hooks.build_start?.())) === false) {
			console.log('BUILD\tcancelled at start');
			return '';
		}

		// create new pseudo-dom from html
		const dom = new jsdom.JSDOM(await this.process_template());
		if (this.style) this.process_style(dom);

		// do hot reload
		if (this.build_options.server?.hot_reload) {
			// get server's socket io
			dom.window.document.head.appendChild(
				(() => {
					const bucket = dom.window.document.createElement('script');
					bucket.setAttribute('__dum_code', 'HR_SOCKETIO');
					bucket.src = `http://${this.build_options.server.hostname}:${this.build_options.server.port}/socket.io/socket.io.js`;
					return bucket;
				})()
			);

			// insert code
			dom.window.document.body.appendChild(
				(() => {
					const bucket = dom.window.document.createElement('script');
					bucket.setAttribute('__dum_code', 'HR');
					bucket.innerHTML =
						'\n' +
						HOT_RELOAD_RAW.replace('$HOST', this.build_options.server?.hostname || '')
							.replace('$PORT', `${this.build_options.server.port}`)
							.trim() +
						'\n';
					return bucket;
				})()
			);
		}

		// process code
		if (this.code) await this.process_code(dom);

		// rasterize dom
		if ((await await_or_undefined(this.hooks.on_rasterize?.(dom))) === false) {
			console.log('BUILD\tcancelled before rasterization');
			return '';
		}
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
		this.hooks.build_done?.();
		return html_string;
	}

	async run() {
		let last_build = await this.build();
		let is_building: boolean = false;

		// function init_watcher(server: http.Server): void;
		// function init_watcher(server: http.Server, ssock: socketio.Server, state: HRState): void;
		const init_watcher = (server: http.Server, ssock?: socketio.Server, state?: HRState) => {
			const target_dir = (ssock && this.build_options.watcher?.watcher_dir) || this.base_dir;

			const watcher = watch.default(target_dir, { recursive: true }, async (ev, target) => {
				if (!is_building) {
					is_building = true;
					if ((await await_or_undefined(this.hooks.on_watch?.(ev, target))) === false) {
						console.log('WATCH\tcancelled');
					} else {
						last_build = await this.build();
						if (ssock && state) {
							state.version += 1;
							ssock.emit('reload');
						}
					}
					is_building = false;
				}
			});
			console.log(`WATCH\t${path.resolve(target_dir)}`);
			return watcher;
		};

		// server
		if (this.build_options.server) {
			const host = this.build_options.server.hostname ?? DEFAULT_HOST;
			const port = this.build_options.server.port ?? DEFAULT_PORT;
			const dir = this.build_options.server.server_dir ?? '.';
			const server = http.createServer((req, res) => {
				let url = req.url ?? '';

				if (this.hooks.on_serve !== undefined) {
					const hooked = this.hooks.on_serve(req, res);
					if (typeof hooked === 'string') url = hooked;
					else if (!hooked) return;
				}

				const url_path = new URL(url, `http://${req.headers.host}`);
				const target_path = url_path.pathname === '/' ? `${this.name}.html` : path.join(dir, url);

				const content_type = dum_mime_type(path.extname(target_path).toLowerCase());
				fs.readFile(target_path, (err, data) => {
					if (err) {
						// If the file is not found, send a 404 response
						console.log(`SERVE\t${content_type}\t404\t${url_path.toString()}`);
						res.writeHead(404, { 'Content-Type': 'text/plain' });
						res.end('File not found');
					} else {
						console.log(`SERVE\t${content_type}\t200\t${url_path.toString()}`);
						res.writeHead(200, { 'Content-Type': content_type });
						res.end(data);
					}
				});
			});

			// hr hooks
			let watcher: watch.Watcher | undefined = undefined;
			if (this.build_options.watcher) {
				if (this.build_options.server.hot_reload) {
					const ssock = new socketio.Server(server);
					const hr_state: HRState = {
						session: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
						version: 0,
					};

					ssock.on('connection', (sock) => {
						sock.on('polling', (session, version) => {
							if (!(session == hr_state.session && version == hr_state.version))
								sock.emit('reload');
						});

						sock.emit('init', hr_state.session, hr_state.version);
					});

					watcher = init_watcher(server, ssock, hr_state);
					console.log(`HR\t${this.build_options.server?.hot_reload ? 'enabled' : 'disabled'}`);
				}
			}

			// server listen
			server.listen(port, host, () => {
				console.log(`SERVE\thttp://${host}:${port}/\n`);
			});
			return new Promise<string>((res) => {
				process.on('SIGINT', function () {
					console.log('Exiting...');
					watcher?.close();
					server.close();
					res(last_build);
				});
			});
		}

		return last_build;
	}
}
