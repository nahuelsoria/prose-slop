'use strict';

const { mask } = require('./mask.js');
const { compile, allRuleIds, normalize } = require('./rules.js');

const SUPPRESS = /<!--\s*prose-slop-(disable-line|disable-next-line|disable|enable)([^>]*?)-->/g;

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return {
    starts,
    at(offset) {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= offset) lo = mid;
        else hi = mid - 1;
      }
      return { line: lo + 1, column: offset - starts[lo] + 1 };
    },
  };
}

// Read from the original text, before masking blanks the HTML comments out.
function readSuppressions(text, index) {
  const perLine = new Map();
  const regions = [];
  let open = null;
  SUPPRESS.lastIndex = 0;
  let m;
  while ((m = SUPPRESS.exec(text)) !== null) {
    const { line } = index.at(m.index);
    const ids = m[2].trim() ? m[2].trim().split(/[\s,]+/) : null;
    if (m[1] === 'disable-line') push(perLine, line, ids);
    else if (m[1] === 'disable-next-line') push(perLine, line + 1, ids);
    else if (m[1] === 'disable') open = { from: line, ids };
    else if (m[1] === 'enable' && open) {
      regions.push({ ...open, to: line });
      open = null;
    }
  }
  if (open) regions.push({ ...open, to: Infinity });
  return { perLine, regions };
}

function push(map, line, ids) {
  const prev = map.get(line);
  if (prev === null) return;              // an unqualified suppression already covers the line
  if (!ids) map.set(line, null);
  else map.set(line, [...(prev || []), ...ids]);
}

function suppressed(finding, sup) {
  const covers = (ids) => ids === null || ids.some((id) => finding.ruleId === id || finding.ruleId.startsWith(id + '.'));
  if (sup.perLine.has(finding.line) && covers(sup.perLine.get(finding.line))) return true;
  return sup.regions.some((r) => finding.line >= r.from && finding.line <= r.to && covers(r.ids));
}

function formatOf(filename) {
  return /\.(md|markdown|mdx)$/i.test(filename || '') ? 'markdown' : 'plain';
}

/**
 * Find every slop tell in a string.
 * @param {string} text
 * @param {{lang?:string, format?:'markdown'|'plain', filename?:string, disable?:string[], add?:object}} options
 * @returns {Array<{ruleId:string, severity:string, message:string, match:string, index:number, line:number, column:number, fixable:boolean}>}
 */
function check(text, options = {}) {
  const format = options.format || formatOf(options.filename);
  const rules = options.rules || compile(options);
  const index = lineIndex(text);
  const sup = readSuppressions(text, index);
  const readable = mask(text, format);
  const findings = [];

  const add = (ruleId, severity, message, at, matched, fixable) => {
    const { line, column } = index.at(at);
    findings.push({ ruleId, severity, message, match: matched, index: at, line, column, fixable: !!fixable });
  };

  for (const rule of rules.chars) {
    let at = readable.indexOf(rule.char);
    while (at !== -1) {
      add(rule.id, rule.severity, rule.message, at, rule.char, true);
      at = readable.indexOf(rule.char, at + 1);
    }
  }

  for (const matcher of rules.words) {
    matcher.regex.lastIndex = 0;
    let m;
    while ((m = matcher.regex.exec(readable)) !== null) {
      const hit = matcher.lookup.get(normalize(m[0]));
      if (hit) add(hit.id, matcher.severity, matcher.message, m.index, text.substr(m.index, m[0].length), false);
      if (m[0].length === 0) matcher.regex.lastIndex++;
    }
  }

  for (const matcher of rules.patterns) {
    matcher.regex.lastIndex = 0;
    let m;
    while ((m = matcher.regex.exec(readable)) !== null) {
      add(matcher.id, matcher.severity, matcher.message, m.index, text.substr(m.index, m[0].length), false);
      if (m[0].length === 0) matcher.regex.lastIndex++;
    }
  }

  return findings
    .filter((f) => !suppressed(f, sup))
    .sort((a, b) => a.index - b.index || a.ruleId.localeCompare(b.ruleId));
}

/**
 * Rewrite only what can be rewritten mechanically: the typographic characters.
 * Word and pattern findings are never auto-edited, because replacing them is a
 * judgement call about meaning and that belongs to whoever wrote the sentence.
 * @returns {{text:string, count:number}}
 */
function fix(text, options = {}) {
  const format = options.format || formatOf(options.filename);
  const rules = options.rules || compile(options);
  const index = lineIndex(text);
  const sup = readSuppressions(text, index);
  const readable = mask(text, format);
  const edits = [];

  for (const rule of rules.chars) {
    let at = readable.indexOf(rule.char);
    while (at !== -1) {
      const { line } = index.at(at);
      if (!suppressed({ ruleId: rule.id, line }, sup)) {
        let from = at;
        let to = at + rule.char.length;
        // Eat one adjacent space where the replacement would otherwise double it
        // up: "a — b" becomes "a, b", "a → b" becomes "a to b". Indentation is
        // never eaten, so a list or a code sample keeps its shape.
        const lineStart = index.starts[line - 1];
        const beforeIsIndent = /^[ \t]*$/.test(text.slice(lineStart, at - 1));
        if (text[at - 1] === ' ' && !beforeIsIndent) from -= 1;
        if (rule.with.endsWith(' ') && text[to] === ' ') to += 1;
        edits.push({ from, to, with: rule.with });
      }
      at = readable.indexOf(rule.char, at + 1);
    }
  }

  edits.sort((a, b) => b.from - a.from);
  let out = text;
  for (const e of edits) out = out.slice(0, e.from) + e.with + out.slice(e.to);
  return { text: out, count: edits.length };
}

/** One-line version for captions and social posts: fixes, then tidies spacing. */
function strip(text, options = {}) {
  return fix(text, { ...options, format: 'plain' })
    .text.replace(/[ \t]{2,}/g, ' ')
    .replace(/ ,/g, ',')
    .trim();
}

/** Markdown-safe version: fixes, and leaves every other byte alone. */
function stripMarkdown(text, options = {}) {
  return fix(text, { ...options, format: 'markdown' }).text;
}

module.exports = { check, fix, strip, stripMarkdown, compile, allRuleIds };
