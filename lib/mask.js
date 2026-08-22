'use strict';

// Everything a prose linter has no business reading gets replaced by spaces of
// the same length. Offsets survive, so line and column numbers stay true and the
// caller can splice the ORIGINAL text at the positions we report.
//
// What gets masked in markdown: YAML frontmatter, fenced code, indented code
// (only where it cannot be a list continuation), inline code spans, link and
// image destinations, reference definitions, bare URLs, HTML tags and HTML
// comments. Prose inside HTML tags is kept: only the tag itself goes.

const INLINE = [
  /<!--[\s\S]*?-->/g,                       // HTML comments (suppressions are read before this)
  /(`+)([^`\n]*)\1/g,                       // inline code spans
  /\]\([^)\n]*\)/g,                         // link and image destinations
  /^[ \t]{0,3}\[[^\]\n]+\]:[^\n]*/gm,       // reference definitions
  /<[a-zA-Z/][^>\n]*>/g,                    // HTML tags
];

const TLD = 'com|net|org|io|dev|app|ai|sh|co|me|xyz|news|blog|site|tech|cloud|ar|es|mx|br|cl|uy|us|uk|de|fr|it';

// Bare domains and email addresses are not prose either, and leaving them in
// used to shatter a line into two-word fragments: the sentence splitter breaks
// on the dot in "nahuelsoria.vercel.app", and every cadence measurement built
// on top of that was reading a CV header as dramatic one-beat sentences.
const URLS = [
  /<?\bhttps?:\/\/[^\s<>)"']+>?/g,
  /[\w.+-]+@[\w-]+\.[\w.-]+/g,
  new RegExp(`(?<![\\w@/.])(?:www\\.)?[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:${TLD})(?:/[^\\s)\\]]*)?`, 'gi'),
];

function makeCanvas(text) {
  const buf = Array.from(text);
  return {
    buf,
    wipe(start, end) {
      for (let i = start; i < end && i < buf.length; i++) {
        if (buf[i] !== '\n') buf[i] = ' ';
      }
    },
    toString() {
      return buf.join('');
    },
  };
}

function lineSpans(text) {
  const spans = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      spans.push([start, i]);
      start = i + 1;
    }
  }
  spans.push([start, text.length]);
  return spans;
}

// Fenced code, frontmatter and indented code need to know what came before, so
// they run as a single pass over the lines instead of as regexes.
function maskBlocks(text, canvas) {
  const spans = lineSpans(text);
  let fence = null;          // the ``` or ~~~ run that opened the current block
  let inFrontmatter = false;
  let prevBlank = true;      // start of file counts as a blank line
  let prevWasListItem = false;
  let inIndented = false;

  for (let n = 0; n < spans.length; n++) {
    const [from, to] = spans[n];
    const line = text.slice(from, to);
    const trimmed = line.trim();

    if (n === 0 && /^---\s*$/.test(trimmed)) {
      inFrontmatter = true;
      canvas.wipe(from, to);
      continue;
    }
    if (inFrontmatter) {
      canvas.wipe(from, to);
      if (/^(---|\.\.\.)\s*$/.test(trimmed)) inFrontmatter = false;
      continue;
    }

    if (fence) {
      canvas.wipe(from, to);
      if (trimmed.startsWith(fence)) fence = null;
      continue;
    }
    const opener = trimmed.match(/^(`{3,}|~{3,})/);
    if (opener) {
      fence = opener[1];
      canvas.wipe(from, to);
      continue;
    }

    // An indented block is code only when a blank line opened it and the last
    // real line was not a list item. Inside a list, that same indent is a
    // continuation paragraph, which is prose we want to read.
    const indented = /^(?: {4,}|\t)/.test(line) && trimmed !== '';
    if (indented && (inIndented || (prevBlank && !prevWasListItem))) {
      inIndented = true;
      canvas.wipe(from, to);
      continue;
    }
    if (trimmed !== '') inIndented = false;

    if (trimmed !== '') prevWasListItem = /^[-*+]\s|^\d+[.)]\s/.test(trimmed);
    prevBlank = trimmed === '';
  }
}

function maskWith(text, canvas, regexes) {
  for (const re of regexes) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      canvas.wipe(m.index, m.index + m[0].length);
      if (m[0].length === 0) re.lastIndex++;
    }
  }
}

/**
 * @param {string} text
 * @param {'markdown'|'plain'} format
 * @returns {string} same length as text, unreadable regions blanked out
 */
function mask(text, format = 'markdown') {
  const canvas = makeCanvas(text);
  if (format === 'markdown') {
    maskBlocks(text, canvas);
    maskWith(text, canvas, INLINE);
  }
  maskWith(text, canvas, URLS);
  return canvas.toString();
}

module.exports = { mask, lineSpans };
