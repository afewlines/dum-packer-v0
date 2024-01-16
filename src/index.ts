import fs from "fs";
import minify from 'html-minifier-terser';
import * as jsdom from 'jsdom';
import watch from 'node-watch';
import * as http from 'node:http';
import * as pug from 'pug';
import * as sass from 'sass';
import * as socketio from 'socket.io';
import ts from 'typescript';

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 5174;

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

export interface DumPackerBuildOpts {
    /** should project be minified */
    minify?: boolean;

    /** hot reload/watch leave empty to disable */
    hot_reload?: {
        directory: string,

        hostname?: string,
        port?: number;
    }
}
export interface DumPackerProjectOpts {
    /** name of the project */
    name: string;

    /** target html page */
    page: string;
    /** target style sheet(s) */
    style?: string | string[];
    /** target target code items(s) */
    code?: string | string[];

    // bundle items?


    /** build options */
    build_options?: DumPackerBuildOpts;
}
/** dum loader Project class */
export class DumPackerProject implements DumPackerProjectOpts {

    name: string;
    page: string;
    style?: string[];
    code?: string[];
    build_options?: DumPackerBuildOpts;
    constructor(opts: DumPackerProjectOpts) {
        this.name = opts.name;
        this.page = opts.page;
        this.style = typeof opts.style === 'string' ? [opts.style] : opts.style;
        this.code = typeof opts.code === 'string' ? [opts.code] : opts.code;
        this.build_options = Object.assign({}, opts.build_options);
        if (this.build_options.hot_reload)
            this.build_options.hot_reload = Object.assign({ hostname: DEFAULT_HOST, port: DEFAULT_PORT }, this.build_options.hot_reload);
    }

    public async build(): Promise<string> {
        console.log(`Building Project '${this.name}'`);

        // project setup
        if (this.style) {
            if (typeof this.style == 'string') this.style = [this.style];
            this.style.reverse();
        }
        if (this.code) {
            if (typeof this.code == 'string') this.code = [this.code];
            this.code.reverse();
        }

        // create new pseudo-dom from html
        const dom = new jsdom.JSDOM((() => {
            return pug.compile(
                fs.readFileSync(this.page, { encoding: 'utf-8' }),
                { pretty: true }
            )().replace(new RegExp(/\t/g), '');
        })());

        // do styles
        if (this.style) {
            for (const style of this.style) {
                // append style bucket to head
                dom.window.document.head.appendChild((() => {
                    // read scss/sass, compile
                    const scss_result = sass.compileString(fs.readFileSync(style, { encoding: 'utf-8' }), {});

                    // simple minify
                    let style_string = scss_result.css;
                    style_string = style_string.replace(new RegExp(/(?:\s?{\s*)/, "g"), '{ ');
                    style_string = style_string.replace(new RegExp(/(?:}\s*)/, "g"), '} ');
                    style_string = style_string.replace(new RegExp(/(?:;\s*)/, "g"), '; ').trim();

                    // create style bucket, fill
                    const bucket = dom.window.document.createElement('style');
                    bucket.innerHTML = style_string;
                    return bucket;
                })());
            }
        }

        // do code
        if (this.code) {
            for (const code of this.code)
                dom.window.document.body.insertBefore((() => {
                    // read typescript, compile
                    const ts_raw = fs.readFileSync(code, { encoding: 'utf-8' });
                    const ts_result = ts.transpileModule(ts_raw, { compilerOptions: {} });
                    // create code bucket, fill
                    const bucket = dom.window.document.createElement('script');
                    bucket.innerHTML = ts_result.outputText;
                    return bucket;
                })(), dom.window.document.body.children[0]);

        }

        // do hot reload?
        if (this.build_options?.hot_reload) {
            dom.window.document.head.appendChild((() => {
                const bucket = dom.window.document.createElement('script');
                bucket.src = `http://${DEFAULT_HOST}:${DEFAULT_PORT}/socket.io/socket.io.js`;
                return bucket;
            })());

            dom.window.document.body.insertBefore((() => {
                const bucket = dom.window.document.createElement('script');
                // bucket.innerHTML = fs.readFileSync('hot_reload_client.js', { encoding: 'utf-8' }).replace('$HOST', DEFAULT_HOST).replace('$PORT', `${DEFAULT_PORT}`);
                bucket.innerHTML = HOT_RELOAD_RAW.replace('$HOST', DEFAULT_HOST).replace('$PORT', `${DEFAULT_PORT}`);
                return bucket;
            })(), dom.window.document.body.children[0]);
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
                version: 0
            }

            // server
            const server = http.createServer((_req, res) => {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/html');
                res.end(last_build);
            });

            const ssock = new socketio.Server(server);
            ssock.on('connection', (sock) => {
                sock.on('polling', (session, version) => {
                    if (!(session == stat.session && version == stat.version)) sock.emit('reload');
                });

                sock.emit('init', stat.session, stat.version);
            });

            // watcher
            const watcher = watch.default(this.build_options.hot_reload.directory, {}, async (_event, _target) => {
                if (!is_building) {
                    is_building = true;
                    last_build = await this.build();
                    stat.version += 1;
                    ssock.emit('reload');
                    is_building = false;
                }
            });
            console.log('Watching...');

            server.listen(DEFAULT_PORT, DEFAULT_HOST, () => {
                console.log(`Server running at http://${DEFAULT_HOST}:${DEFAULT_PORT}/\n`);
            });
        }

        return last_build
    }
}