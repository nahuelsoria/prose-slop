#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const slop = require('../lib/index.js');
const { compile, allRuleIds } = require('../lib/rules.js');
const pkg = require('../package.json');

const TEXT_EXT = /\.(md|markdown|mdx|txt)$/i;
const SKIP_DIR = /^(node_modules|\.git|\.next|dist|build|coverage|vendor)$/;

const USAGE = `prose-slop ${pkg.version}

  slop check [files|dirs...]   report the slop tells (default command)
  slop fix   [files|dirs...]   rewrite the typographic ones in place
  slop strip [files...]        print the one-line clean version to stdout
  slop rules                   list every rule id

Options
  --lang <auto|en|es>         rule sets to run; auto runs both (default)
  --format <markdown|plain>   override the format inferred from the extension
  --strict                    exit 1 on warnings too, not only on errors
  --json                      machine-readable findings
  --quiet                     print errors only
  --config <path>             config file; default is the nearest .proseslop.json
  --no-color                  plain output

Use - to read stdin. Exit code is 1 when the gate fails, 2 on a usage error.
`;

function parseArgs(argv) {
  const opts = { command: null, files: [], lang: null, format: null, strict: false, json: false, quiet: false, color: null, config: null };
  const commands = new Set(['check', 'fix', 'strip', 'rules', 'help', 'version']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.command = 'help';
    else if (a === '--version' || a === '-v') opts.command = 'version';
    else if (a === '--strict') opts.strict = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--quiet' || a === '-q') opts.quiet = true;
    else if (a === '--no-color') opts.color = false;
    else if (a === '--lang') opts.lang = argv[++i];
    else if (a === '--format') opts.format = argv[++i];
    else if (a === '--config') opts.config = argv[++i];
    else if (a.startsWith('--')) fail(`unknown option: ${a}`);
    else if (!opts.command && commands.has(a)) opts.command = a;
    else opts.files.push(a);
  }
  opts.command = opts.command || 'check';
  return opts;
}

function fail(message) {
  process.stderr.write(`prose-slop: ${message}\n`);
  process.exit(2);
}

function findConfig(explicit) {
  if (explicit) return explicit;
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, '.proseslop.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadConfig(explicit) {
  const file = findConfig(explicit);
  if (!file) return {};
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(`cannot read ${file}: ${err.message}`);
  }
  const known = allRuleIds();
  for (const id of config.disable || []) {
    if (!known.includes(id) && !known.some((k) => k.startsWith(id + '.'))) {
      process.stderr.write(`prose-slop: ${file} disables "${id}", which is not a rule\n`);
    }
  }
  return config;
}

function expand(entries) {
  const out = [];
  for (const entry of entries) {
    if (entry === '-') {
      out.push('-');
      continue;
    }
    let stat;
    try {
      stat = fs.statSync(entry);
    } catch (err) {
      fail(`cannot read ${entry}: ${err.message}`);
    }
    if (stat.isDirectory()) walk(entry, out);
    else out.push(entry);
  }
  return out;
}

function walk(dir, out) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name.startsWith('.') || SKIP_DIR.test(item.name)) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full, out);
    else if (TEXT_EXT.test(item.name)) out.push(full);
  }
  out.sort();
}

function readFile(file) {
  try {
    return fs.readFileSync(file === '-' ? 0 : file, 'utf8');
  } catch (err) {
    fail(`cannot read ${file === '-' ? 'stdin' : file}: ${err.message}`);
  }
}

const ESC = String.fromCharCode(27);

function makePaint(enabled) {
  const wrap = (code) => (s) => (enabled ? `${ESC}[${code}m${s}${ESC}[0m` : s);
  return { red: wrap(31), yellow: wrap(33), dim: wrap(2), bold: wrap(1), green: wrap(32) };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.command === 'help') return void process.stdout.write(USAGE);
  if (opts.command === 'version') return void process.stdout.write(pkg.version + '\n');
  if (opts.command === 'rules') return void process.stdout.write(allRuleIds().join('\n') + '\n');

  const config = loadConfig(opts.config);
  const base = {
    lang: opts.lang || config.lang || 'auto',
    disable: config.disable || [],
    add: config.add || {},
  };
  if (!['auto', 'en', 'es'].includes(base.lang)) fail(`unknown language: ${base.lang}`);
  if (opts.format && !['markdown', 'plain'].includes(opts.format)) fail(`unknown format: ${opts.format}`);
  const rules = compile(base);
  const strict = opts.strict || config.strict === true;

  const files = expand(opts.files.length ? opts.files : ['-']);
  const color = opts.color === null ? Boolean(process.stdout.isTTY) && !process.env.NO_COLOR : opts.color;
  const paint = makePaint(color);

  if (opts.command === 'strip') {
    for (const file of files) process.stdout.write(slop.strip(readFile(file), { ...base, rules }) + '\n');
    return;
  }

  const report = [];
  let errors = 0;
  let warnings = 0;
  let fixable = 0;
  let rewritten = 0;

  for (const file of files) {
    let text = readFile(file);
    const per = { ...base, rules, filename: file === '-' ? 'stdin.md' : file, format: opts.format || undefined };

    if (opts.command === 'fix') {
      const result = slop.fix(text, per);
      rewritten += result.count;
      text = result.text;
      if (file === '-') process.stdout.write(text);
      else if (result.count) fs.writeFileSync(file, text);
    }

    const findings = slop.check(text, per).filter((f) => !(opts.quiet && f.severity === 'warn'));
    for (const f of findings) {
      if (f.severity === 'error') errors++;
      else warnings++;
      if (f.fixable) fixable++;
    }
    if (findings.length) report.push({ file, findings });
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ files: report, errors, warnings, fixable, rewritten }, null, 2) + '\n');
  } else {
    const width = Math.max(0, ...report.flatMap((e) => e.findings.map((f) => f.ruleId.length)));
    for (const entry of report) {
      process.stdout.write('\n' + paint.bold(entry.file === '-' ? 'stdin' : entry.file) + '\n');
      for (const f of entry.findings) {
        const where = `${f.line}:${f.column}`.padEnd(8);
        const level = f.severity === 'error' ? paint.red('error') : paint.yellow('warn ');
        process.stdout.write(`  ${paint.dim(where)}${level}  ${f.ruleId.padEnd(width + 2)}${f.message}\n`);
      }
    }
    const total = errors + warnings;
    process.stdout.write('\n');
    if (opts.command === 'fix') {
      process.stdout.write(rewritten ? paint.green(`fixed ${rewritten} character${rewritten === 1 ? '' : 's'}\n`) : 'nothing to fix\n');
    }
    if (!total) process.stdout.write(paint.green('clean\n'));
    else {
      process.stdout.write(`${total} finding${total === 1 ? '' : 's'}: ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}\n`);
      if (fixable) process.stdout.write(paint.dim(`${fixable} of them are fixable with 'slop fix'\n`));
    }
  }

  process.exit(errors > 0 || (strict && warnings > 0) ? 1 : 0);
}

main();
