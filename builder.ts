import minify from 'html-minifier-terser';
import * as jsdom from 'jsdom';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as pug from 'pug';
import * as sass from 'sass';
import * as socketio from 'socket.io';
import ts from 'typescript';
import Watcher from 'watcher';

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 5174;

interface SimpleHTML {
    name: string;
    page: string;
    style?: string[];
    code?: string[];

    build_options?: {
        minify?: boolean;
        hot_reload?: boolean;
    }
}

async function build(target: SimpleHTML) {

    console.log(`Building Project '${target.name}'`);
    // project setup
    target.code?.reverse();

    // read pug, compile
    // const pug_result = pug.compile(
    //     fs.readFileSync(target.page, { encoding: 'utf-8' }),
    //     { pretty: true }
    // )().replace(new RegExp(/\t/, 'g'), '');

    // create new pseudo-dom from html
    const dom = new jsdom.JSDOM((() => {
        return pug.compile(
            fs.readFileSync(target.page, { encoding: 'utf-8' }),
            { pretty: true }
        )().replace(new RegExp(/\t/g), '');
    })());

    // do styles
    if (target.style) {
        for (const style of target.style) {
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
    if (target.code) {
        for (const code of target.code)
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
    if (target.build_options?.hot_reload) {
        dom.window.document.head.appendChild((() => {
            const bucket = dom.window.document.createElement('script');
            bucket.src = `http://${DEFAULT_HOST}:${DEFAULT_PORT}/socket.io/socket.io.js`;
            return bucket;
        })());

        dom.window.document.body.insertBefore((() => {
            const bucket = dom.window.document.createElement('script');
            bucket.innerHTML = fs.readFileSync('hot_reload_client.js', { encoding: 'utf-8' }).replace('$HOST', DEFAULT_HOST).replace('$PORT', `${DEFAULT_PORT}`);
            return bucket;
        })(), dom.window.document.body.children[0]);
    }

    // rasterize dom
    let html_string = dom.serialize();
    const html_file = `${target.name}.html`;

    // minimize
    if (target.build_options?.minify) {
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



async function main(target: SimpleHTML) {

    let last_build = await build(target);
    if (target.build_options.hot_reload) {
        let is_building: boolean = false;
        const stat = {
            session: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
            version: 0
        }

        // server
        const server = http.createServer((req, res) => {
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
        const watch = new Watcher('template/', {});
        watch.on('all', async (event: string, targetPath: string) => {
            if (event == 'change' && !is_building) {
                is_building = true;
                last_build = await build(target);
                stat.version += 1;
                ssock.emit('reload');
                is_building = false;
            }
        });
        watch.on('close', () => console.log('Closing...'));
        console.log('Watching...');

        server.listen(DEFAULT_PORT, DEFAULT_HOST, () => {
            console.log(`Server running at http://${DEFAULT_HOST}:${DEFAULT_PORT}/\n`);
        });
    }
}


(() => {

    const args = process.argv;
    // TODO: get in here

    // main({
    //     name: 'evalml',
    //     page: 'template/index.pug',
    //     style: ['template/style.scss'],
    //     code: ['template/index.ts'],

    //     build_options: {
    //         // minify: true,
    //         // hot_reload: true,
    //     },
    // });

})();
