'use strict';

const chars = require('../rules/chars.json');
const patterns = require('../rules/patterns.json');
const LANGS = { en: require('../rules/en.json'), es: require('../rules/es.json') };
const { RULES: STRUCTURE } = require('./structure.js');

// Rule ids are stable and hierarchical, so a config can disable one term
// ("es.banned.faro", for the text about an actual lighthouse) or a whole group
// ("en.adverbs") with the same field.
function slug(term) {
  return term
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalize(text) {
  return text.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A term is matched with Unicode lookarounds instead of \b: \b is ASCII-only and
// would fire in the middle of "días" or "año". Apostrophes match both the straight
// and the curly form, and a run of whitespace matches a line wrap, so a phrase
// still gets caught when the paragraph is hard-wrapped across two lines.
function termSource(term) {
  return escapeRe(term).replace(/'/g, "['’]").replace(/ /g, '\\s+');
}

function isDisabled(id, disabled) {
  return disabled.some((d) => id === d || id.startsWith(d + '.'));
}

function buildWordMatchers(langs, extra, disabled) {
  const matchers = [];
  for (const lang of langs) {
    const spec = LANGS[lang];
    if (!spec) throw new Error(`unknown language: ${lang}`);
    for (const group of spec.groups) {
      const added = (extra[lang] && extra[lang][group.id]) || [];
      const lookup = new Map();
      const terms = [];
      for (const term of [...group.terms, ...added]) {
        const id = `${lang}.${group.id}.${slug(term)}`;
        if (isDisabled(id, disabled)) continue;
        terms.push(term);
        lookup.set(normalize(term), { id, term });
      }
      if (!terms.length) continue;
      // Longest first so "in the world of" wins over "in the world".
      terms.sort((a, b) => b.length - a.length);
      const source = terms.map(termSource).join('|');
      matchers.push({
        lang,
        group: group.id,
        severity: group.severity,
        message: group.message,
        lookup,
        regex: new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, 'gimu'),
      });
    }
  }
  return matchers;
}

function buildPatternMatchers(langs, disabled) {
  const out = [];
  for (const p of patterns.patterns) {
    if (p.lang !== 'any' && !langs.includes(p.lang)) continue;
    const id = `pattern.${p.id}`;
    if (isDisabled(id, disabled)) continue;
    for (const source of p.regexes) {
      out.push({
        id,
        severity: p.severity,
        message: p.message,
        regex: new RegExp(source, p.flags || 'gimu'),
      });
    }
  }
  return out;
}

function buildCharMatchers(lang, disabled) {
  return chars.replacements
    .map((r) => ({
      id: `chars.${r.id}`,
      char: r.char,
      with: typeof r.with === 'string' ? r.with : r.with[lang] || r.with.en,
      severity: 'error',
      fixable: true,
      message: `${r.name}. Replace it with ${JSON.stringify(
        typeof r.with === 'string' ? r.with : r.with[lang] || r.with.en
      )}.`,
    }))
    .filter((r) => !isDisabled(r.id, disabled));
}

/**
 * @param {{lang?: string, disable?: string[], add?: object}} options
 */
function compile(options = {}) {
  const lang = options.lang || 'auto';
  const langs = lang === 'auto' ? ['en', 'es'] : [lang];
  const disabled = options.disable || [];
  return {
    langs,
    chars: buildCharMatchers(langs[0], disabled),
    structure: STRUCTURE.filter((r) => !r.optIn || (options.enable || []).includes(r.id))
      .map((r) => r.id)
      .filter((id) => !isDisabled(id, disabled)),
    words: buildWordMatchers(langs, options.add || {}, disabled),
    patterns: buildPatternMatchers(langs, disabled),
  };
}

// Every rule id this build knows about, for `slop rules` and for validating a
// config that disables something that no longer exists.
function allRuleIds() {
  const ids = new Set();
  for (const r of chars.replacements) ids.add(`chars.${r.id}`);
  for (const [lang, spec] of Object.entries(LANGS)) {
    for (const group of spec.groups) {
      for (const term of group.terms) ids.add(`${lang}.${group.id}.${slug(term)}`);
    }
  }
  for (const p of patterns.patterns) ids.add(`pattern.${p.id}`);
  for (const r of STRUCTURE) ids.add(r.id);
  return [...ids].sort();
}

module.exports = { compile, allRuleIds, normalize, slug, isDisabled };
