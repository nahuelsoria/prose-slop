# prose-slop

Lint the prose you publish for AI slop. English and Spanish, zero dependencies.

Every "AI slop" linter on npm reads your **code**. This one reads what you ship to
readers: posts, docs, READMEs, landing copy, release notes, captions. It catches
the em dash you did not type, the vocabulary a model reaches for, and the seven
sentence shapes that give a draft away.

```console
$ slop check post.md

post.md
  3:14    error  chars.em-dash                em dash. Replace it with ",".
  7:1     error  pattern.throat-clearing      Throat-clearing opener. Cut it and state the point.
  9:22    error  en.banned.delve              AI vocabulary. Say it in a word a person would use.
  14:5    warn   en.phrases.at-the-end-of-the-day  Delays the point. Cut it and start at the point.

4 findings: 3 errors, 1 warning
1 of them are fixable with 'slop fix'
```

## Install

```bash
npm install -g prose-slop     # then: slop check post.md
npx prose-slop check post.md  # or without installing
```

Node 18 or newer. No dependencies, so the install is a single small package.

## Use

```bash
slop check post.md docs/          # a file, a directory, or both
slop check --strict content/      # warnings fail the gate too
slop check --json posts/          # for CI
slop fix post.md                  # rewrite the typographic tells in place
cat caption.txt | slop strip      # one clean line on stdout, for a social post
slop rules                        # every rule id
```

Exit code is 1 when the gate fails and 2 on a usage error, so it drops into CI as
is. A directory walk picks up `.md`, `.markdown`, `.mdx` and `.txt`, and skips
`node_modules`, `dist` and dotfolders.

## What it catches

| Group | Severity | English | Español |
| --- | --- | --- | --- |
| `chars` | error | em dash, en dash, arrow, curly quotes | same set |
| `banned` | error | `delve`, `tapestry`, `cutting-edge`, `game changer` | `sinergia`, `disruptivo`, `de vanguardia`, `imperdible` |
| `context` | warn | `leverage`, `robust`, `streamline` | `robusto`, `optimizar`, `potenciar`, `ecosistema` |
| `adverbs` | warn | `literally`, `simply`, `truly`, `crucially` | `simplemente`, `realmente`, `obviamente`, `sin duda` |
| `phrases` | warn | `at the end of the day`, `in today's world` | `hoy en día`, `cabe destacar`, `vale la pena destacar` |
| `verbos` | warn | | `se erige como`, `se posiciona como`, `viene a resolver` |

Plus eight sentence patterns, which survive translation and ship in both
languages:

- **binary-contrast**: `The question isn't the model, it's the eval.` / `No se trata de X sino de Y.` Also `less X, more Y`, `you don't need X, you need Y` and `menos X, más Y`
- **negated-tail**: `It is a linter, not a rewriter.` / `Las dos reglas estaban mal, no mi texto.` (warn, see below)
- **throat-clearing**: `Let me be clear,` / `Seamos sinceros,`
- **faux-insight**: `Here's what nobody tells you.` / `Lo que nadie te cuenta.`
- **colon-reveal**: `The best part: it learns.` (warn, the heuristic is fuzzy)
- **superficial-analysis**: `..., highlighting the team's commitment.` / `..., demostrando el compromiso.`
- **importance-puffery**: `marks a pivotal moment` / `es un hito`
- **weasel-attribution**: `studies show` / `los expertos coinciden`

Errors are the tells with no defense. Warnings are the words that mean something
real in technical writing and nothing at all in marketing copy: `robust` earns its
place in `a robust retry policy` and never in `a robust solution`. The tool
reports both and lets you decide, which is why `context`, `adverbs` and `phrases`
are warnings.

`negated-tail` is a warning for the same reason, and it took some work to make it
one worth reading. The shape is only rhetoric when the pair is abstract:
`It is a linter, not a rewriter.` When the tail names something specific it is
doing honest work, so `It runs on Neon, not the VPS Postgres.` stays quiet. The
capital letter is what tells them apart, which is why that rule alone runs
case-sensitive.

## It also reads the shape of the document

Word rules miss the thing most people notice first. A draft can pass every
vocabulary check and still read as generated, because what gives it away is the
cadence: paragraphs of equal size, sentences of equal length, three bullets that
open the same way, and a lesson dropped on its own line at the end.

Seven cadence rules run over the parsed document instead of over a span of text:

| Rule | What it looks for |
| --- | --- |
| `structure.aphoristic-closer` | The piece ends on a standalone one-liner that generalises |
| `structure.closing-question` | It ends on a question aimed at the reader |
| `structure.parallel-openers` | Three or more sentences in a row start with the same word |
| `structure.uniform-rhythm` | Every sentence is about the same length |
| `structure.uniform-paragraphs` | Every paragraph is the same size |
| `structure.listicle-bullets` | Three or more bullets open with the same bolded lead-in |
| `structure.fragment-drama` | One-beat fragments used as a tic (opt-in, see below) |

All of them are warnings. Rhythm is a style choice and a linter has no business
calling it an error.

They only run on flowing prose. A block of short lines is a note, a spec or a CV,
so cadence rules skip it, and so do quoted lines, tables and headings. That gate
is what took the false positives on a 173-file corpus from 47 down to 12.

`structure.fragment-drama` ships off by default. The tic is real, but on that
same corpus it only ever fired on CVs, trackers and prompt files, never on
narrative. A rule that cannot tell a clipped instruction from a dramatic beat
does not belong in the default set, so you turn it on yourself:

```bash
slop check --enable structure.fragment-drama post.md
```

## What it rewrites, and what it refuses to

`slop fix` only rewrites the typographic characters. That substitution is
mechanical and cannot change what a sentence means.

Everything else gets reported and never edited. Replacing `delve` or unwinding a
binary contrast changes meaning, and that call belongs to whoever wrote the
sentence. A linter that silently rewrites your argument is worse than the slop.

## It understands markdown

Findings come from the prose only. Fenced code, indented code, inline spans, link
destinations, reference definitions, bare URLs, HTML tags and YAML frontmatter are
all invisible to the rules, and a `fix` leaves them byte for byte intact, trailing
two-space line breaks included.

An indented block counts as code only where it cannot be a list continuation, so
the paragraph under a bullet still gets linted.

## Suppressions

```markdown
El faro de Mar del Plata. <!-- prose-slop-disable-line es.banned.faro -->

<!-- prose-slop-disable-next-line -->
This line is exempt.

<!-- prose-slop-disable -->
Anything in here is exempt.
<!-- prose-slop-enable -->
```

Naming a rule limits the suppression to that rule. A bare comment covers the whole
line or region.

## Config

Drop a `.proseslop.json` anywhere above the files you lint:

```json
{
  "lang": "auto",
  "strict": false,
  "disable": ["en.adverbs", "es.banned.faro"],
  "enable": ["structure.fragment-drama"],
  "add": { "es": { "banned": ["mojon"] } }
}
```

`disable` takes a rule id (`es.banned.faro`), a group (`en.adverbs`) or a whole
family (`chars`, `structure`). `enable` turns on the opt-in rules. `add` extends a
group with your own terms. Run `slop rules` for the full list of ids.

`lang` defaults to `auto`, which runs both rule sets, because the two vocabularies
barely overlap and a lot of writing mixes languages. Pin it with `--lang en` or
`--lang es`.

## API

```js
const { check, fix, strip, stripMarkdown } = require('prose-slop');

check('Let me be clear: this is huge.');
// [{ ruleId: 'pattern.throat-clearing', severity: 'error', line: 1, column: 1, ... }]

fix('a — b').text;              // 'a, b'
strip('  Uso A — B  ');         // 'Uso A, B'   one line, for a caption
stripMarkdown(readme);          // same, byte-safe for markdown
```

Pass `{ lang, format, filename, disable, add }` to any of them. Compile the rules
once with `compile()` and hand them back as `{ rules }` when you lint many files.

## In CI

```yaml
- run: npx prose-slop check --strict docs/ README.md
```

As a pre-commit hook:

```bash
git diff --cached --name-only --diff-filter=ACM -z \
  | grep -z '\.mdx\?$' \
  | xargs -0 -r npx prose-slop check
```

This repo lints its own README on every test run, which is how the examples above
stay honest.

## Noise, measured

A linter that shouts at good prose gets turned off, so the rules were tuned
against real writing rather than against invented examples. Over 173 markdown
files from a personal vault and a working publishing repo, `prose-slop` reports
388 errors, and 375 of them are the typographic characters. Of the 13 that are
left, 9 are binary contrasts and 4 are marketing vocabulary. The rules stay quiet
on prose that a person wrote, which is the whole design target.

The cadence rules report 12 findings across those same 173 files. Reading them
one by one is worth the trouble: the documents behind the rhythm warnings turned
out to be the ones an agent had written, so the rule was right and the corpus was
not as human as it looked.

That run is also what narrowed two rules. `harness` used to fire on every
mention of a test harness, so now only the verb forms count. The colon-reveal
check used to read `Stack completo:` and `Objetivo declarado:` as drama, so it
now looks for the phrases that promise a reveal.

## Where the rules come from

The character table has been gating a fleet of unattended writing agents since
August 2026, after three of them separately grew their own copy of it. Prompting a
model to avoid an em dash does not work; the model puts it back. A check in code
does work, and this is that check, plus the vocabulary and the sentence shapes
that the same editing pass kept catching by hand.

MIT. Issues and new terms welcome, in either language.
