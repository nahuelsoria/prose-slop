'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const slop = require('../lib/index.js');
const { mask } = require('../lib/mask.js');
const { compile, allRuleIds } = require('../lib/rules.js');

const CLI = path.join(__dirname, '..', 'bin', 'prose-slop.js');
let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push({ name, err });
  }
}

const ids = (text, options) => slop.check(text, { format: 'plain', ...options }).map((f) => f.ruleId);
const md = (text, options) => slop.check(text, { format: 'markdown', ...options }).map((f) => f.ruleId);

// --- characters -------------------------------------------------------------

test('flags every typographic tell', () => {
  const found = ids('a — b – c → d “e” ‘f’');
  assert.deepStrictEqual(new Set(found), new Set(['chars.em-dash', 'chars.en-dash', 'chars.arrow', 'chars.smart-quote', 'chars.smart-apos']));
});

test('fix collapses the spaces around a replaced dash', () => {
  assert.strictEqual(slop.fix('a — b', { format: 'plain' }).text, 'a, b');
  assert.strictEqual(slop.fix('a—b', { format: 'plain' }).text, 'a,b');
  assert.strictEqual(slop.fix('a → b', { format: 'plain' }).text, 'a to b');
  assert.strictEqual(slop.fix('a → b', { format: 'plain', lang: 'es' }).text, 'a a b');
});

test('fix leaves a markdown hard break and the indentation alone', () => {
  const before = '  - item — one  \n';
  assert.strictEqual(slop.stripMarkdown(before), '  - item, one  \n');
});

test('fix never eats indentation to the left of the character', () => {
  assert.strictEqual(slop.fix('  — hola', { format: 'plain' }).text, '  , hola');
});

test('fix leaves an indented code block untouched', () => {
  assert.strictEqual(slop.stripMarkdown('parrafo\n\n    codigo — aca\n'), 'parrafo\n\n    codigo — aca\n');
});

test('strip returns one tidy line', () => {
  assert.strictEqual(slop.strip('  Uso A — B y flecha → C  '), 'Uso A, B y flecha to C');
});

// --- masking ----------------------------------------------------------------

test('mask keeps offsets', () => {
  const text = '```\nconst a = 1;\n```\ntexto\n';
  assert.strictEqual(mask(text).length, text.length);
});

test('code fences, inline code and URLs are not prose', () => {
  assert.deepStrictEqual(md('```js\nconst a = 1 — 2;\n```\n'), []);
  assert.deepStrictEqual(md('Con `a — b` adentro.'), []);
  assert.deepStrictEqual(md('Ver https://x.com/a—b'), []);
  assert.deepStrictEqual(md('[texto](https://x.com/a—b)'), []);
});

test('frontmatter is not prose', () => {
  assert.deepStrictEqual(md('---\ntitle: a — b\n---\n\nlimpio\n'), []);
});

test('an indented code block is not prose, a list continuation is', () => {
  assert.deepStrictEqual(md('parrafo\n\n    codigo — aca\n'), []);
  assert.deepStrictEqual(md('- item\n\n  sigue — el item\n'), ['chars.em-dash']);
});

test('link text is still prose', () => {
  assert.deepStrictEqual(md('[delve into it](https://x.com)'), ['en.banned.delve']);
});

// --- words ------------------------------------------------------------------

test('word boundaries do not fire inside a longer word', () => {
  assert.deepStrictEqual(ids('justify the farola'), []);
  assert.deepStrictEqual(ids('just the faro'), ['en.adverbs.just', 'es.banned.faro']);
});

test('accented terms match and get a clean rule id', () => {
  assert.deepStrictEqual(ids('Sumérgete en el tema'), ['es.banned.sumergete']);
  assert.ok(allRuleIds().includes('es.banned.sumergete'));
});

test('a curly apostrophe still matches the phrase', () => {
  assert.deepStrictEqual(ids('It’s worth noting').filter((i) => i.startsWith('en.')), ['en.phrases.it-s-worth-noting']);
});

test('a phrase wrapped across two lines still matches', () => {
  assert.ok(ids('at the end of\nthe day it works').includes('en.phrases.at-the-end-of-the-day'));
});

test('the longest term wins', () => {
  assert.deepStrictEqual(ids('in the world of software'), ['en.phrases.in-the-world-of']);
});

test('both languages run by default and can be narrowed', () => {
  assert.deepStrictEqual(ids('delve y sinergia').sort(), ['en.banned.delve', 'es.banned.sinergia']);
  assert.deepStrictEqual(ids('delve y sinergia', { lang: 'es' }), ['es.banned.sinergia']);
});

// --- patterns ---------------------------------------------------------------

test('structural patterns fire in both languages', () => {
  assert.ok(ids("The question isn't the model.").includes('pattern.binary-contrast'));
  assert.ok(ids('No es solo un linter, sino un gate.').includes('pattern.binary-contrast'));
  assert.ok(ids('Studies show it works.').includes('pattern.weasel-attribution'));
  assert.ok(ids('Sumo busqueda, demostrando el compromiso.').includes('pattern.superficial-analysis'));
  assert.ok(ids('Lo que nadie te cuenta sobre npm.').includes('pattern.faux-insight'));
});

test('a colon reveal is a warning, a label is not', () => {
  const reveal = slop.check('The best part: it learns from the corrections.', { format: 'plain' });
  assert.ok(reveal.some((f) => f.ruleId === 'pattern.colon-reveal' && f.severity === 'warn'));
  assert.ok(ids('Lo mejor: aprende de las correcciones.').includes('pattern.colon-reveal'));
  assert.ok(ids('El detalle que lo hace funcionar: un agente aparte lo califica.').includes('pattern.colon-reveal'));
  // Labels the rule explicitly allows. Every one of these came out of a real
  // vault and used to be a false positive under the old syntactic heuristic.
  assert.deepStrictEqual(md('Install: `npm i`'), []);
  assert.deepStrictEqual(ids('Stack completo: bash, jq, cron, la CLI de Vercel.'), []);
  assert.deepStrictEqual(ids('Objetivo declarado: bajar grasa y subir masa muscular.'), []);
  assert.deepStrictEqual(ids('Tentative dates: travel to Brazil in June.'), []);
});

test('harness is slop as a verb and fine as a noun', () => {
  assert.deepStrictEqual(ids('The test harness the team built works.'), []);
  assert.deepStrictEqual(ids('Harnessing the power of AI.'), ['en.banned.harnessing']);
});

test('the negated tail is caught in both languages', () => {
  assert.ok(ids('Both rules were wrong, not my writing.').includes('pattern.negated-tail'));
  assert.ok(ids('It is a linter, not a rewriter.').includes('pattern.negated-tail'));
  assert.ok(ids('Las dos reglas estaban mal, no mi texto.').includes('pattern.negated-tail'));
  assert.ok(ids('Es una herramienta, no un juguete.').includes('pattern.negated-tail'));
});

test('a tail that disambiguates something concrete is left alone', () => {
  // The capital letter and the digit are the signal: naming a specific thing is
  // a legitimate use of the construction, not rhetoric.
  for (const frase of [
    'It runs on Neon, not the VPS Postgres.',
    'Corre en Neon, no la base de Vercel.',
    'El deploy tarda 4 minutos, no los 20 de antes.',
    'I shipped it, not really tested.',
    'It broke twice, not because of the code.',
  ]) {
    assert.ok(!ids(frase).includes('pattern.negated-tail'), frase);
  }
});

test('the flags on negated-tail keep the case check alive', () => {
  // Regression: with the i flag, \p{Lu} inside a negated class case-folds and
  // excludes every letter, so the rule silently matched nothing at all.
  const { compile } = require('../lib/rules.js');
  const cola = compile().patterns.filter((p) => p.id === 'pattern.negated-tail');
  assert.ok(cola.length > 0);
  assert.ok(cola.every((p) => !p.regex.flags.includes('i')));
});

test('the extended binary contrast forms are caught', () => {
  assert.ok(ids('This is not about speed. It is about trust.').includes('pattern.binary-contrast'));
  assert.ok(ids('You do not need a framework. You need a function.').includes('pattern.binary-contrast'));
  assert.ok(ids('Less configuration, more defaults everywhere.').includes('pattern.binary-contrast'));
  assert.ok(ids('Menos configuracion, mas defaults en todos lados.').includes('pattern.binary-contrast'));
  assert.ok(ids('No se trata del modelo sino del eval.').includes('pattern.binary-contrast'));
});

test('two regexes of one rule over the same words report once', () => {
  const found = ids('Both rules were wrong, not my writing.').filter((i) => i === 'pattern.negated-tail');
  assert.strictEqual(found.length, 1);
});

// --- positions and suppressions ---------------------------------------------

test('line and column point at the character', () => {
  const [f] = slop.check('linea uno\nlinea — dos\n', { format: 'plain' });
  assert.strictEqual(f.line, 2);
  assert.strictEqual(f.column, 7);
});

test('suppression comments work per line, per next line and per region', () => {
  assert.deepStrictEqual(md('texto — aca <!-- prose-slop-disable-line -->'), []);
  assert.deepStrictEqual(md('<!-- prose-slop-disable-next-line -->\ntexto — aca'), []);
  assert.deepStrictEqual(md('<!-- prose-slop-disable -->\na — b\nc — d\n<!-- prose-slop-enable -->'), []);
  assert.deepStrictEqual(md('El faro de Mar del Plata. <!-- prose-slop-disable-line es.banned.faro -->'), []);
  assert.deepStrictEqual(md('El faro. <!-- prose-slop-disable-line es.banned.sinergia -->'), ['es.banned.faro']);
});

test('fix respects a suppression too', () => {
  const text = 'a — b <!-- prose-slop-disable-line -->';
  assert.strictEqual(slop.fix(text, { format: 'markdown' }).count, 0);
});

// --- config -----------------------------------------------------------------

test('disable takes a whole group or a single term', () => {
  assert.deepStrictEqual(ids('just delve', { disable: ['en.adverbs'] }), ['en.banned.delve']);
  assert.deepStrictEqual(ids('just delve', { disable: ['en.banned.delve'] }), ['en.adverbs.just']);
  assert.deepStrictEqual(ids('a — b', { disable: ['chars'] }), []);
});

test('add extends a group without touching the rules file', () => {
  const found = ids('esto es un mojon', { add: { es: { banned: ['mojon'] } } });
  assert.deepStrictEqual(found, ['es.banned.mojon']);
});

// --- CLI --------------------------------------------------------------------

function cli(args, input) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { input: input || '', encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status, stdout: err.stdout || '' };
  }
}

test('the CLI exits 1 on an error and 0 on clean text', () => {
  assert.strictEqual(cli(['check', '--no-color', '-'], 'delve into it').code, 1);
  assert.strictEqual(cli(['check', '--no-color', '-'], 'texto limpio y corto').code, 0);
});

test('warnings only fail the gate under --strict', () => {
  assert.strictEqual(cli(['check', '--no-color', '-'], 'esto es simplemente asi').code, 0);
  assert.strictEqual(cli(['check', '--no-color', '--strict', '-'], 'esto es simplemente asi').code, 1);
});

test('--json reports the counts', () => {
  const out = JSON.parse(cli(['check', '--json', '-'], 'delve — aca').stdout);
  assert.strictEqual(out.errors, 2);
  assert.strictEqual(out.fixable, 1);
});

test('fix rewrites a file in place and walks a directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prose-slop-'));
  fs.writeFileSync(path.join(dir, 'a.md'), 'uno — dos\n');
  fs.writeFileSync(path.join(dir, 'skip.json'), '{"a": "b — c"}\n');
  const run = cli(['fix', '--no-color', dir]);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'a.md'), 'utf8'), 'uno, dos\n');
  assert.ok(fs.readFileSync(path.join(dir, 'skip.json'), 'utf8').includes('—'));
  assert.ok(run.stdout.includes('fixed 1 character'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('strip prints the clean line to stdout', () => {
  assert.strictEqual(cli(['strip', '-'], 'A — B').stdout, 'A, B\n');
});

test('rules lists every id', () => {
  const out = cli(['rules']).stdout.trim().split('\n');
  assert.deepStrictEqual(out, allRuleIds());
  assert.ok(out.length > 120);
});

test('a big --json report survives the pipe', () => {
  // process.exit() used to truncate this mid-string once the report outgrew the
  // pipe buffer, which made the output unparseable exactly when it mattered.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prose-slop-big-'));
  const line = 'Un parrafo con un guion largo — adentro y una comilla “rara”.\n';
  for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(dir, `f${i}.md`), line.repeat(30));
  const out = cli(['check', '--json', dir]);
  const parsed = JSON.parse(out.stdout);
  assert.strictEqual(parsed.errors, 40 * 30 * 3);
  assert.strictEqual(out.code, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a usage error exits 2 without a stack trace', () => {
  const out = cli(['check', '--lang', 'fr', '-'], 'x');
  assert.strictEqual(out.code, 2);
});

// --- structure --------------------------------------------------------------

const NARRATIVA =
  'Compare este parrafo con el resto del documento, porque necesita largo real para contar como narrativa y no como una nota suelta de dos palabras sueltas en una linea.\n\n' +
  'Otro parrafo con suficiente cuerpo para que el documento entero pase el filtro de prosa y las reglas de cadencia se activen sobre algo que valga la pena medir.\n\n' +
  'Un tercero que suma las palabras necesarias para pasar los pisos minimos, porque una regla de cadencia sobre cuatro oraciones no mide nada y no deberia opinar.\n\n';

test('the aphoristic closer fires on a generated post and not on the rewrite', () => {
  const generado = fs.readFileSync(path.join(__dirname, 'fixtures', 'generated-post.txt'), 'utf8');
  const reescrito = fs.readFileSync(path.join(__dirname, 'fixtures', 'rewritten-post.txt'), 'utf8');
  assert.ok(ids(generado).includes('structure.aphoristic-closer'));
  assert.deepStrictEqual(ids(reescrito), []);
});

test('the closer rule looks past a trailing install line', () => {
  const conCTA = NARRATIVA + 'A linter that yells at good writing gets uninstalled.\n\nnpm i -g prose-slop\n';
  assert.ok(ids(conCTA).includes('structure.aphoristic-closer'));
});

test('an instruction, a spec line or a conditional is not an aphorism', () => {
  for (const cierre of [
    'Use one worktree per agent and review the diff before pushing.',
    'Solo lectura, tope diario, cero merges automaticos.',
    'Si tengo que recortar el mensaje antes de publicarlo, pierdo tiempo.',
    'El deploy tarda 4 minutos.',
  ]) {
    assert.deepStrictEqual(ids(NARRATIVA + cierre + '\n'), [], cierre);
  }
});

test('three sentences opening with the same word are a pattern, in a list they are not', () => {
  const parrafo = NARRATIVA + 'This is the first one and it runs long enough. This is the second one with a similar shape. This is the third one closing the run.\n';
  assert.ok(ids(parrafo).includes('structure.parallel-openers'));
  const lista = NARRATIVA + '- This is the first item of the list\n- This is the second item of the list\n- This is the third item of the list\n';
  assert.ok(!md(lista).includes('structure.parallel-openers'));
});

test('uniform sentence length is flagged and varied length is not', () => {
  // Nine sentences of exactly the same length, three per paragraph.
  const frase = (i) => `Esta oracion numero ${i} tiene doce palabras justas para medir el ritmo.`;
  const uniforme = [0, 1, 2]
    .map((p) => [0, 1, 2].map((j) => frase(p * 3 + j)).join(' '))
    .join('\n\n');
  assert.ok(ids(uniforme).includes('structure.uniform-rhythm'));
  const variado = NARRATIVA + 'Corta. Esta segunda oracion se extiende bastante mas y agrega detalle concreto sobre lo que paso el martes a la tarde. Otra corta. Y esta ultima vuelve a estirarse con una explicacion larga que cambia el ritmo del parrafo por completo.\n';
  assert.ok(!ids(variado).includes('structure.uniform-rhythm'));
});

test('bolded listicle lead-ins are flagged, a definition list is not', () => {
  const listicle = NARRATIVA + '- **Start with the user first**: escribi lo que necesita.\n- **Measure before you tune it**: sin numeros no hay ajuste.\n- **Ship it and then iterate**: el resto es teoria.\n';
  assert.ok(md(listicle).includes('structure.listicle-bullets'));
  const definiciones = NARRATIVA + '- **chars**: los caracteres tipograficos.\n- **banned**: el vocabulario prohibido.\n- **context**: las palabras que dependen del contexto.\n';
  assert.ok(!md(definiciones).includes('structure.listicle-bullets'));
});

test('cadence rules stay out of note-shaped blocks', () => {
  const notas = '## Focus\n\nOne thing: validar.\nWhy: importa.\nQuien: yo.\nCuando: hoy.\n';
  assert.deepStrictEqual(md(notas).filter((i) => i.startsWith('structure')), []);
});

test('fragment-drama is off by default and can be turned on', () => {
  const texto = NARRATIVA + 'Probe el deploy y fallo. Otra vez. Lo corri de nuevo con el flag puesto y volvio a fallar igual. Otra vez. Mire los logs completos y no decian nada util. Nada. Al final era el DNS. Siempre.\n';
  assert.ok(!ids(texto).includes('structure.fragment-drama'));
  assert.ok(ids(texto, { enable: ['structure.fragment-drama'] }).includes('structure.fragment-drama'));
});

test('bare domains and emails are masked out of the prose', () => {
  assert.deepStrictEqual(md('Escribime a delve@gmail.com o entra a delve.com/harness'), []);
  assert.deepStrictEqual(md('Node.js y package.json siguen siendo prosa: delve.'), ['en.banned.delve']);
});

// --- dogfood ----------------------------------------------------------------

test('the README passes its own linter', () => {
  const readme = path.join(__dirname, '..', 'README.md');
  if (!fs.existsSync(readme)) return;
  const findings = slop
    .check(fs.readFileSync(readme, 'utf8'), { filename: 'README.md' })
    .filter((f) => f.severity === 'error');
  assert.deepStrictEqual(findings.map((f) => `${f.line}:${f.column} ${f.ruleId}`), []);
});

test('compile is reusable across files', () => {
  const rules = compile({ lang: 'en' });
  assert.deepStrictEqual(slop.check('delve', { format: 'plain', rules }).map((f) => f.ruleId), ['en.banned.delve']);
  assert.deepStrictEqual(slop.check('delve', { format: 'plain', rules }).map((f) => f.ruleId), ['en.banned.delve']);
});

// --- report -----------------------------------------------------------------

for (const f of failures) {
  process.stderr.write(`\nFAIL  ${f.name}\n${f.err.message}\n`);
}
process.stdout.write(`\n${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length ? 1 : 0);
