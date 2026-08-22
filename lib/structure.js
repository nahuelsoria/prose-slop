'use strict';

const { parse, variation } = require('./blocks.js');

// Cadence rules. The v0.1 rules read words and single sentences, which is why a
// text can pass them all and still read as a machine wrote it: what gives it
// away is the shape of the whole piece. Everything here is a warning, because
// rhythm is a style choice and a linter has no business calling it an error.

const PRIMERA = (s) => (s.tokens[0] || '').toLowerCase().replace(/[^\p{L}']/gu, '');
const PERSONAL = /(?<!\p{L})(i|we|my|our|me|us|yo|mi|mis|nosotros|nuestro|nuestra)(?!\p{L})/iu;
const SEGUNDA = /(?<!\p{L})(you|your|vos|tu|tus|te|ustedes|usted)(?!\p{L})/iu;
const CONCRETO = /\d|@|\$|https?:|`/;

// A closer is a generalisation, not a fact: no numbers, no names, nobody in it.
function esAforismo(s) {
  if (s.words < 4 || s.words > 18) return false;
  if (CONCRETO.test(s.text)) return false;
  if (PERSONAL.test(s.text)) return false;
  if (/[?]$/.test(s.text.trim())) return false;
  // A proper noun anywhere after the opening word means it is about something
  // specific, so it is a statement and not a moral.
  const resto = s.tokens.slice(1);
  if (resto.some((w) => /^\p{Lu}/u.test(w))) return false;
  return true;
}

// A post usually ends on an install line, a link or a handle. That is a call to
// action, not the closing sentence, so the closer rules look past it.
const COMANDO = /^(npm|npx|pnpm|yarn|bun|pip|brew|curl|git|go|cargo|docker|sudo|apt)\s/i;

function esCTA(block) {
  const t = block.text.trim();
  if (COMANDO.test(t)) return true;
  if (/^(https?:|@|#)/.test(t)) return true;
  return !/[.!?…]["')\]]*$/.test(t) && t.split(/\s+/).length <= 8;
}

// A block of short lines is a note, a spec or a CV, not a paragraph. Cadence
// only means something in flowing prose, and measuring it on a list of labels
// was where most of the false positives came from.
function esParrafo(block) {
  if (block.kind !== 'prose') return false;
  const lineas = block.text.split('\n').filter((l) => l.trim() !== '');
  const palabras = lineas.map((l) => l.trim().split(/\s+/).length);
  if (!palabras.some((n) => n >= 12)) return false;
  return palabras.reduce((a, b) => a + b, 0) / palabras.length >= 8;
}

// An aphorism is one clean declarative clause. An instruction, a spec line or a
// list of noun phrases is none of those, and they were most of the noise.
const SUBORDINADA = /^(if|when|while|although|though|because|since|unless|after|before|si|cuando|aunque|mientras|porque|como|despu[eé]s|antes)(?!\p{L})/iu;
const IMPERATIVO = /^(use|keep|run|review|check|make|write|add|set|avoid|start|stop|remember|usar?|revisar?|correr|mantener|evitar|agregar|escribir|empezar|recordar|dejar)(?!\p{L})/iu;

function esDeclarativa(s) {
  if (!/^\p{Lu}/u.test(s.text.trim())) return false;
  if ((s.text.match(/,/g) || []).length > 1) return false;
  if (IMPERATIVO.test(s.text.trim())) return false;
  if (SUBORDINADA.test(s.text.trim())) return false;
  return true;
}

function narrativos(doc) {
  // El documento tiene que ser narrativo (algun parrafo de verdad), pero el
  // bloque de cierre no: un cierre aforistico es corto por definicion.
  if (!doc.prose.some(esParrafo)) return [];
  const bloques = doc.prose.filter((b) => b.kind === 'prose');
  let fin = bloques.length;
  while (fin > 0 && esCTA(bloques[fin - 1])) fin--;
  return bloques.slice(0, fin);
}

const RULES = [
  {
    id: 'structure.aphoristic-closer',
    message: 'The piece ends on a standalone one-liner that generalises. End on the last concrete thing instead.',
    run(doc) {
      const bloques = narrativos(doc);
      if (doc.words < 80 || bloques.length < 3) return [];
      const ultimo = bloques[bloques.length - 1];
      if (!ultimo.sentences || ultimo.sentences.length !== 1) return [];
      const s = ultimo.sentences[0];
      return esAforismo(s) && esDeclarativa(s) ? [{ index: s.start, match: s.text }] : [];
    },
  },
  {
    id: 'structure.closing-question',
    message: 'The piece ends on a question aimed at the reader. Cut it or ask something you actually want answered.',
    run(doc) {
      const bloques = narrativos(doc);
      if (doc.words < 60 || bloques.length < 2) return [];
      const ultimo = bloques[bloques.length - 1];
      if (!ultimo.sentences || ultimo.sentences.length !== 1) return [];
      const s = ultimo.sentences[0];
      if (!/\?["')\]]*$/.test(s.text.trim())) return [];
      if (!SEGUNDA.test(s.text) && !/^(what|how|why|which|qu[eé]|c[oó]mo|por qu[eé])(?!\p{L})/iu.test(s.text)) return [];
      return [{ index: s.start, match: s.text }];
    },
  },
  {
    id: 'structure.parallel-openers',
    message: 'Three or more sentences in a row open with the same word. Break the pattern or merge them.',
    run(doc) {
      const out = [];
      for (const block of doc.prose) {
        if (!esParrafo(block)) continue;
        let racha = [];
        for (const s of block.sentences.concat([null])) {
          const palabra = s ? PRIMERA(s) : null;
          if (racha.length && palabra === PRIMERA(racha[0]) && palabra.length >= 2) {
            racha.push(s);
            continue;
          }
          if (racha.length >= 3) out.push({ index: racha[0].start, match: `${racha.length}x "${PRIMERA(racha[0])}"` });
          racha = s ? [s] : [];
        }
      }
      return out;
    },
  },
  {
    id: 'structure.uniform-rhythm',
    message: 'Every sentence is about the same length. Vary them: a short one after two long ones is what makes prose sound spoken.',
    threshold: 0.34,
    run(doc, rule) {
      const frases = doc.prose.filter(esParrafo).flatMap((b) => b.sentences);
      if (frases.length < 6 || doc.words < 90) return [];
      const cv = variation(frases.map((s) => s.words));
      return cv < rule.threshold ? [{ index: frases[0].start, match: `cv=${cv.toFixed(2)}` }] : [];
    },
  },
  {
    id: 'structure.uniform-paragraphs',
    message: 'Every paragraph is the same size. That even block rhythm is the clearest tell of a generated draft.',
    threshold: 0.2,
    run(doc, rule) {
      const bloques = doc.prose.filter(esParrafo);
      if (bloques.length < 4 || doc.words < 120) return [];
      const cv = variation(bloques.map((b) => b.text.trim().length));
      return cv < rule.threshold ? [{ index: bloques[0].start, match: `cv=${cv.toFixed(2)}` }] : [];
    },
  },
  {
    id: 'structure.fragment-drama',
    // Off by default. The tic is real, but on a corpus of 173 files it fired on
    // CVs, trackers and prompt files and never on narrative prose. A rule that
    // cannot tell a clipped instruction from a dramatic beat does not belong in
    // the default set, so it is opt-in until the detection gets better.
    optIn: true,
    message: 'Too many one-beat fragments used for emphasis. One lands, four of them is a tic.',
    run(doc) {
      const bloques = doc.prose.filter(esParrafo);
      const frases = bloques.flatMap((b) => b.sentences);
      if (frases.length < 6 || doc.words < 60) return [];
      const solos = new Set();
      for (const b of bloques) {
        for (const linea of b.text.split('\n')) {
          const t = linea.trim();
          if (t && b.sentences.some((s) => s.text === t)) solos.add(t);
        }
      }
      const cortas = frases.filter(
        (s) => s.words > 0 && s.words <= 3 && /[.!]["')\]]*$/.test(s.text.trim()) && !solos.has(s.text.trim())
      );
      if (cortas.length < 4 || cortas.length / frases.length < 0.2) return [];
      return [{ index: cortas[0].start, match: `${cortas.length} de ${frases.length}` }];
    },
  },
  {
    id: 'structure.listicle-bullets',
    message: 'Three or more bullets that all open with the same bolded lead-in. Write them as prose or drop the bold.',
    run(doc) {
      const out = [];
      for (const block of doc.prose) {
        if (block.kind !== 'list') continue;
        const items = block.text.split('\n').filter((l) => l.trim() !== '');
        let racha = 0;
        let desde = null;
        let at = block.start;
        for (const line of items) {
          // A bolded lead-in of three or more words is a listicle heading. One or
          // two words is a definition list, which is a legitimate way to write.
          const m = line.match(/^\s{0,3}(?:[-*+]|\d+[.)])\s+\*\*([^*]+)\*\*\s*[:.]/);
          const largo = m && m[1].trim().split(/\s+/).length >= 3;
          if (largo) {
            if (!racha) desde = at;
            racha++;
          } else {
            if (racha >= 3) out.push({ index: desde, match: `${racha} bullets` });
            racha = 0;
          }
          at += line.length + 1;
        }
        if (racha >= 3) out.push({ index: desde, match: `${racha} bullets` });
      }
      return out;
    },
  },
];

function runStructure(masked, enabled) {
  const doc = parse(masked);
  const out = [];
  for (const rule of RULES) {
    if (!enabled.includes(rule.id)) continue;
    for (const hit of rule.run(doc, rule)) {
      out.push({ ruleId: rule.id, severity: 'warn', message: rule.message, index: hit.index, match: hit.match });
    }
  }
  return out;
}

module.exports = { runStructure, RULES };
