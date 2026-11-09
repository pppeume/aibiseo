// claude.ai 아티팩트용 단일 HTML 생성: node artifact/build.mjs [출력경로]
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = process.argv[2] || path.join(here, 'dist', 'kiot-rr.html');
const EXCELJS_CDN = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';

const redirect = {
  name: 'browser-redirect',
  setup(b) {
    b.onResolve({ filter: /^\.\/store\.js$/ }, (a) => (a.importer.includes(`${path.sep}rr${path.sep}`) ? { path: path.join(here, 'browser-store.js') } : undefined));
    b.onResolve({ filter: /^(fs|path)$/ }, () => ({ path: path.join(here, 'shims.js') }));
    b.onResolve({ filter: /^exceljs$/ }, () => ({ path: path.join(here, 'exceljs-shim.js') }));
  },
};

const res = await build({
  entryPoints: [path.join(here, 'main.js')], bundle: true, format: 'iife', write: false, minify: false,
  target: 'es2020', plugins: [redirect], define: { 'process.env.RR_TZ': 'undefined' }, legalComments: 'none',
});
const bundle = res.outputFiles[0].text;
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'style.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script src="app.js">')).trim();
const fontLinks = (html.match(/<link rel="(?:preconnect|stylesheet)" href="https:\/\/fonts[^>]*>/g) || []).join('\n');
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

const page = `<title>K-IoT PLUS 업무관리</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fontLinks}
<style>
${css}
</style>
${body}
<script src="${EXCELJS_CDN}"></script>
<script>window.RR_DEFER = true;</script>
<script>
${safe(app)}
</script>
<script>
${safe(bundle)}
</script>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`built ${out} (${(page.length / 1024).toFixed(0)} KB)`);
