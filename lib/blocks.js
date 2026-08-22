'use strict';

// Structure rules need the shape of the document, not a span of text, so the
// masked source gets parsed into blocks and sentences first. Everything here
// runs on the MASKED text (code, URLs and frontmatter already blanked out) and
// keeps absolute offsets, so a finding still points at a real line.

const ABBR = new Set([
  'e.g.', 'i.e.', 'etc.', 'vs.', 'mr.', 'mrs.', 'ms.', 'dr.', 'st.', 'no.', 'fig.',
  'ej.', 'p.ej.', 'ee.uu.', 'sr.', 'sra.', 'srta.', 'lic.', 'ing.', 'av.', 'pag.',
]);

const LIST = /^\s{0,3}(?:[-*+]\s|\d+[.)]\s)/;
const HEADING = /^\s{0,3}#{1,6}\s/;
const QUOTE = /^\s{0,3}>/;
const TABLE = /^\s*\|.*\|\s*$/;

function classify(text) {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (!lines.length) return 'blank';
  if (lines.every((l) => HEADING.test(l))) return 'heading';
  if (lines.some((l) => TABLE.test(l))) return 'table';
  if (lines.every((l) => QUOTE.test(l))) return 'quote';
  if (LIST.test(lines[0])) return 'list';
  return 'prose';
}

/**
 * Split the document on blank lines, keeping the offset of each block.
 *
 * A heading also ends a block even with no blank line after it. Without that,
 * "## Pipeline" glued to the bullets under it parses as one prose paragraph,
 * and a dashboard of headed lists reads to the cadence rules as three evenly
 * sized paragraphs.
 */
function parseBlocks(masked) {
  const out = [];
  const lineas = [];
  let at = 0;
  for (const linea of masked.split('\n')) {
    lineas.push({ text: linea, start: at });
    at += linea.length + 1;
  }

  let actual = [];
  const cerrar = () => {
    if (!actual.length) return;
    const start = actual[0].start;
    const end = actual[actual.length - 1].start + actual[actual.length - 1].text.length;
    const raw = masked.slice(start, end);
    if (raw.trim() !== '') out.push({ kind: classify(raw), start, end, text: raw });
    actual = [];
  };

  for (const linea of lineas) {
    if (linea.text.trim() === '') {
      cerrar();
      continue;
    }
    if (HEADING.test(linea.text)) {
      cerrar();
      actual = [linea];
      cerrar();
      continue;
    }
    actual.push(linea);
  }
  cerrar();
  return out;
}

/** Sentences inside one block, with their offsets and word counts. */
function parseSentences(block) {
  // A list block is a set of items, not a paragraph: each item is its own unit,
  // otherwise the bullets read as one very long sentence and every rhythm
  // measurement on the document goes wrong.
  const sinCitas = block.text
    .split('\n')
    .map((l) => (QUOTE.test(l) ? ' '.repeat(l.length) : l))
    .join('\n');
  const chunks =
    block.kind === 'list'
      ? splitLines(block)
      : [{ text: sinCitas, start: block.start }];

  const out = [];
  for (const chunk of chunks) {
    let buffer = '';
    let bufferStart = null;
    const re = /[^.!?…\n]*[.!?…]+["')\]]*|[^.!?…\n]+$/g;
    let m;
    while ((m = re.exec(chunk.text)) !== null) {
      if (m[0].trim() === '') continue;
      if (bufferStart === null) bufferStart = chunk.start + m.index;
      buffer += m[0];
      const tail = buffer.trim().split(/\s+/).pop().toLowerCase();
      const abre = ABBR.has(tail) || /^\p{L}\.$/u.test(tail) || /^\d+\.$/.test(tail);
      const cierra = /[.!?…]["')\]]*$/.test(buffer.trim());
      if (cierra && !abre) {
        out.push(sentence(buffer, bufferStart));
        buffer = '';
        bufferStart = null;
      }
    }
    if (buffer.trim() !== '') out.push(sentence(buffer, bufferStart));
  }
  return out.filter((s) => s.words > 0 && !esHueco(s.text));
}

// A masked region leaves a run of spaces behind. A "sentence" made mostly of
// that hole is a URL or an email, not prose, and counting it wrecked every
// cadence measurement built on sentence length.
function esHueco(text) {
  return /\s{4,}/.test(text.trim());
}

function splitLines(block) {
  const out = [];
  let at = block.start;
  for (const line of block.text.split('\n')) {
    if (line.trim() !== '') out.push({ text: line.replace(LIST, ''), start: at + (line.length - line.replace(LIST, '').length) });
    at += line.length + 1;
  }
  return out;
}

function sentence(text, start) {
  const clean = text.trim();
  const words = clean.split(/\s+/).filter((w) => /\p{L}|\p{N}/u.test(w));
  return { text: clean, start: start + (text.length - text.trimStart().length), words: words.length, tokens: words };
}

/** Coefficient of variation. Low means every unit is the same size. */
function variation(values) {
  if (values.length < 2) return Infinity;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (!mean) return Infinity;
  const varianza = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(varianza) / mean;
}

function parse(masked) {
  const blocks = parseBlocks(masked);
  const prose = blocks.filter((b) => b.kind === 'prose' || b.kind === 'list');
  const sentences = [];
  for (const b of prose) {
    b.sentences = parseSentences(b);
    sentences.push(...b.sentences);
  }
  return {
    blocks,
    prose,
    sentences,
    words: sentences.reduce((a, s) => a + s.words, 0),
  };
}

module.exports = { parse, parseBlocks, parseSentences, variation };
