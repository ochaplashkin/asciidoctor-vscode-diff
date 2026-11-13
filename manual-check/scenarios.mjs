const imageOne = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#3b82f6"/><text x="10" y="45" fill="white">one</text></svg>`
const imageTwo = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#10b981"/><text x="10" y="45" fill="white">two</text></svg>`

export const hostFiles = {
  '/docs/images/one.svg': Buffer.from(imageOne),
  '/docs/images/two.svg': Buffer.from(imageTwo),
}

const header = `= Manual
:toc: left
:imagesdir: images
:data-uri:
:source-highlighter: highlight.js
`

function doc(body, extraHeader = '') {
  return `${header}${extraHeader}\n${body}\n`
}

function sections(count, mutate = () => '') {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1
    return `== Section ${n}\n\nParagraph ${n} with some words about topic ${n}.\n\n* item ${n}.1\n* item ${n}.2\n\n[source,json]\n----\n{"section": ${n}, "ok": true}\n----\n${mutate(n)}`
  }).join('\n')
}

export const scenarios = [
  {
    name: 'identical-rich',
    old: doc(`
== Overview

Hello *world* and _AsciiDoc_.

* one
* two

[cols="1,1"]
|===
|A |B
|1 |2
|===

[source,json]
----
{"a": 1, "b": 2}
----

image::one.svg[Diagram, 200]
`),
    new: doc(`
== Overview

Hello *world* and _AsciiDoc_.

* one
* two

[cols="1,1"]
|===
|A |B
|1 |2
|===

[source,json]
----
{"a": 1, "b": 2}
----

image::one.svg[Diagram, 200]
`),
  },
  {
    name: 'unrelated-documents',
    old: doc(`
== Old overview

Old prose about alpha with *bold* text and a link to https://example.com/old[old site].

== Old list

* alpha
* beta
* gamma

[source,ruby]
----
puts "old"
----
`),
    new: doc(`
== New introduction

Completely different prose about omega and _emphasis_.

|===
|Key |Value
|new |42
|===

image::two.svg[New diagram, 160]
`),
  },
  {
    name: 'sections-reordered',
    old: doc(sections(5)),
    new: doc(
      [3, 1, 5, 2, 4]
        .map((n) =>
          `== Section ${n}\n\nParagraph ${n} with some words about topic ${n}.\n\n* item ${n}.1\n* item ${n}.2\n\n[source,json]\n----\n{"section": ${n}, "ok": true}\n----\n`,
        )
        .join('\n'),
    ),
  },
  {
    name: 'table-cardinal',
    old: doc(`
== Data

[cols="1,1,1"]
|===
|Name |Count |Status

|alpha |1 |ready
|beta |2 |draft
|gamma |3 |ready
|===
`),
    new: doc(`
== Data

[cols="1,1,1,1,1"]
|===
|Name |Count |Severity |Status |Owner

|alpha |1 |high |ready |ann
|beta |2 |medium |ready |bob
|gamma |3 |low |published |carl
|epsilon |5 |high |new |eve
|===
`),
  },
  {
    name: 'table-cell-middle',
    old: doc(`
== Data

[cols="1,1,1,1"]
|===
|Name |Count |Status |Owner

|alpha |1 |ready |ann
|beta |2 |ready |bob
|gamma |3 |draft |carl
|delta |4 |ready |dina
|===
`),
    new: doc(`
== Data

[cols="1,1,1,1"]
|===
|Name |Count |Status |Owner

|alpha |1 |ready |ann
|beta |2 |ready |bob
|gamma |3 |published |carl
|delta |4 |ready |dina
|===
`),
  },
  {
    name: 'table-row-middle',
    old: doc(`
== Data

[cols="1,1,1"]
|===
|Name |Count |Status

|alpha |1 |ready
|beta |2 |ready
|gamma |3 |draft
|===
`),
    new: doc(`
== Data

[cols="1,1,1"]
|===
|Name |Count |Status

|alpha |1 |ready
|beta |2 |ready
|inserted |9 |new
|gamma |3 |draft
|===
`),
  },
  {
    name: 'table-column-middle',
    old: doc(`
== Data

[cols="1,1,1"]
|===
|Name |Count |Status

|alpha |1 |ready
|beta |2 |ready
|gamma |3 |draft
|===
`),
    new: doc(`
== Data

[cols="1,1,1,1"]
|===
|Name |Count |Severity |Status

|alpha |1 |high |ready
|beta |2 |medium |ready
|gamma |3 |low |draft
|===
`),
  },
  {
    name: 'table-span',
    old: doc(`
== Spans

[cols="1,1,1,1"]
|===
|A |B |C |D

2+|merged |x |y
|a |b |c |d
|e |f |g |h
|===
`),
    new: doc(`
== Spans

[cols="1,1,1,1"]
|===
|A |B |C |D

|a |b |c |d
2+|changed |x |y
|e |f |g |h
|===
`),
  },
  {
    name: 'code-json',
    old: doc(`
== JSON

[source,json]
----
{
  "name": "alpha",
  "version": 1,
  "enabled": true,
  "tags": ["one", "two"]
}
----
`),
    new: doc(`
== JSON

[source,json]
----
{
  "name": "alpha",
  "version": 2,
  "enabled": false,
  "tags": ["one", "three"]
}
----
`),
  },
  {
    name: 'code-huge',
    old: doc(`
== Huge

[source,text]
----
${Array.from({ length: 2200 }, (_, i) => `line ${i + 1}`).join('\n')}
----
`),
    new: doc(`
== Huge

[source,text]
----
${Array.from({ length: 2200 }, (_, i) => (i === 1100 ? 'line CHANGED' : `line ${i + 1}`)).join('\n')}
----
`),
  },
  {
    name: 'lists',
    old: doc(`
== Lists

* one
* two
** nested two
* three

. first
. second
. third

term one:: definition one
term two:: definition two

* [x] done
* [ ] todo
`),
    new: doc(`
== Lists

* one
* inserted
* two
** nested two changed
* three

. first
. second changed
. third

term one:: definition one changed
term two:: definition two
term three:: definition three

* [x] done
* [ ] todo
* [ ] added
`),
  },
  {
    name: 'blocks',
    old: doc(`
== Blocks

NOTE: note text

TIP: tip text

WARNING: warning text

CAUTION: caution text

IMPORTANT: important text

.Example title
====
example text
====

.Sidebar title
****
sidebar text
****

[quote, Someone]
____
quote text
____

[verse]
____
verse text
____

[literal]
....
literal text
....
`),
    new: doc(`
== Blocks

NOTE: changed note text

TIP: tip text

WARNING: changed warning text

CAUTION: caution text

IMPORTANT: changed important text

.Example title changed
====
example text changed
====

.Sidebar title
****
changed sidebar text
****

[quote, Someone Else]
____
changed quote text
____

[verse]
____
changed verse text
____

[literal]
....
changed literal text
....
`),
  },
  {
    name: 'diagrams',
    old: doc(`
== Diagrams

[mermaid]
----
graph TD; A-->B; B-->C;
----

[plantuml]
----
Alice -> Bob: old message
----

image::one.svg[Diagram, 200]
`),
    new: doc(`
== Diagrams

[mermaid]
----
graph TD; A-->D; D-->C;
----

[plantuml]
----
Alice -> Bob: new message
Bob -> Alice: reply
----

image::two.svg[Diagram, 200]
`),
  },
  {
    name: 'media-attrs',
    old: doc(`
== Media

image::one.svg[Diagram, 200]

image::one.svg[Other, 100]
`),
    new: doc(`
== Media

image::one.svg[Diagram, 300]

image::two.svg[Other, 100]
`),
  },
  {
    name: 'xref-links',
    old: doc(`
== Links

See <<target>> and https://example.com/one[the site].

[[target]]
=== Target

Target text.
`),
    new: doc(`
== Links

See <<target2>> and https://example.com/two[the site].

[[target2]]
=== Target

Target text.
`),
  },
  {
    name: 'top-heavy',
    old: doc(sections(12)),
    new: doc(`== Brand new top\n\nA long new section.\n\n* a\n* b\n\n${sections(12)}`),
  },
  {
    name: 'empty-vs-full',
    old: `= Empty\n`,
    new: doc(`
== Content

Some content.

* one
* two

[source,json]
----
{"x": 1}
----
`),
  },
  {
    name: 'toc-shell',
    old: doc(`
== One

text one

== Two

text two
`, ':toc: right'),
    new: doc(`
== One

text one

== Two

text two changed
`),
  },
  {
    name: 'unicode',
    old: doc(`
== Unicode

Привет, мир! 日本語のテキスト。 עברית.

* 😀 emoji
* 中文
`),
    new: doc(`
== Unicode

Привет, изменённый мир! 日本語のテキスト。 עברית.

* 😀 emoji changed
* 中文新增
`),
  },
  {
    name: 'nested-cell',
    old: doc(`
== Nested

[cols="1,2"]
|===
|Kind |Content

a|
* one
* two
a|
[source,json]
----
{"x": 1}
----
|===
`),
    new: doc(`
== Nested

[cols="1,2"]
|===
|Kind |Content

a|
* one
* three
a|
[source,json]
----
{"x": 2}
----
|===
`),
  },
  {
    name: 'callouts',
    old: doc(`
== Callouts

[source,ruby]
----
puts "one" # <1>
puts "two" # <2>
----
<1> first
<2> second
`),
    new: doc(`
== Callouts

[source,ruby]
----
puts "one"   # <1>
puts "two"   # <2>
puts "three" # <3>
----
<1> first changed
<2> second
<3> third
`),
  },
  {
    name: 'math',
    old: doc(
      `
== Math

[stem]
++++
E = mc^2
++++

Inline stem:[x^2 + y^2] here.
`,
      ':stem: latexmath',
    ),
    new: doc(
      `
== Math

[stem]
++++
E = mc^3
++++

Inline stem:[x^2 + z^2] here.
`,
      ':stem: latexmath',
    ),
  },
  {
    name: 'footnotes',
    old: doc(`
== Footnotes

Text with a footnote.footnote:[First note.]

Another sentence.
`),
    new: doc(`
== Footnotes

Text with a changed footnote.footnote:[Second note.]

Another sentence.
`),
  },
  {
    name: 'pass-block',
    old: doc(`
== Pass

pass:[<span class="custom">raw one</span>]

++++
<div class="raw">block one</div>
++++
`),
    new: doc(`
== Pass

pass:[<span class="custom">raw two</span>]

++++
<div class="raw">block two</div>
++++
`),
  },
  {
    name: 'doctype-shell',
    old: `= Book
:doctype: book
:toc: left
:source-highlighter: highlight.js

== One

text one

== Two

text two
`,
    new: `= Article
:toc: right
:source-highlighter: highlight.js

== One

text one changed

== Two

text two
`,
  },
  {
    name: 'table-no-header',
    old: doc(`
== No header

[cols="1,1"]
|===
|alpha |1
|beta |2
|gamma |3
|===
`),
    new: doc(`
== No header

[cols="1,1,1"]
|===
|alpha |high |1
|beta |medium |2
|gamma |low |3
|===
`),
  },
  {
    name: 'csv-table',
    old: doc(`
== CSV

[format=csv,cols="2*"]
|===
Name,Value
alpha,1
beta,2
|===
`),
    new: doc(`
== CSV

[format=csv,cols="2*"]
|===
Name,Value
alpha,10
beta,2
|===
`),
  },
  {
    name: 'formatting-classes',
    old: doc(`
== Classes

[.text-left]
A paragraph with the same text.

*Important:* something.
`),
    new: doc(`
== Classes

[.text-center]
A paragraph with the same text.

_Important:_ something.
`),
  },
  {
    name: 'inline',
    old: doc(`
== Inline

**bold** and *italic* and \`mono\` and kbd:[Ctrl+C] and btn:[OK].

A link to https://example.com/one[example] and an inline image image:one.svg[icon,16,16].
`),
    new: doc(`
== Inline

**bold changed** and _italic_ and \`mono\` and kbd:[Ctrl+V] and btn:[Cancel].

A link to https://example.com/two[example] and an inline image image:two.svg[icon,16,16].
`),
  },
  {
    name: 'admonition-types',
    old: doc(`
== Admonitions

NOTE: note

TIP: tip

WARNING: warning

CAUTION: caution

IMPORTANT: important
`),
    new: doc(`
== Admonitions

WARNING: warning

CAUTION: caution changed

IMPORTANT: important

NOTE: note changed

TIP: tip changed
`),
  },
  {
    name: 'big-doc',
    old: doc(sections(100)),
    new: doc(
      sections(100, (n) =>
        n === 60 ? '\nA new paragraph in section 60, inserted in the middle.\n' : '',
      ),
    ),
  },
  {
    name: 'shift-above',
    old: doc(`
== Intro

Line one.

Line two.

== Target

Old target text.
`),
    new: doc(`
== Intro

Line one.

Line inserted above.

Line two.

== Target

New target text.
`),
  },
]
