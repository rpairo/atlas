# Security

Atlas is designed to draw boards that come from somewhere you do not fully trust: a user's saved
file, an API response, another team's repository.

## What Atlas guarantees

- **No HTML from the data.** Every text of a board is inserted with `textContent`, never as HTML.
  No URL or CSS value is taken from the data. The only attributes that carry data are `data-lane`
  (a validated id) and the part names made from `type` and `status`, which must match a strict
  pattern first (`[A-Za-z0-9_-]{1,32}` and `[a-z0-9_-]{1,32}`).
- **No prototype pollution.** JSON text is parsed without letting `__proto__`, `constructor` or
  `prototype` keys through, and those names are refused as ids.
- **Bounded work.** Documents over 512 KB and boards over the [limits](board-format.md#limits)
  are rejected before any placement or routing runs. Placement uses bounded iterations, and the
  routing search stops at a fixed amount of work (`ROUTE.budget`), so one selection cannot freeze
  the page.
- **Validated edits.** Every edit validates the whole board, and a failing batch leaves it
  untouched.
- **Same-origin boards.** `<atlas-map src>` refuses boards from another origin unless the element
  has the `cross-origin` attribute.
- **No network, no storage.** Atlas makes no requests of its own (except `<atlas-map src>`, which
  fetches the URL you give it), and stores nothing.

## What stays your responsibility

- **`renderNode`.** A custom node renderer receives board data. Insert it with `textContent`; if
  you use `innerHTML`, you are responsible for sanitising it.
- **Where boards come from.** `cross-origin` lets the element fetch any URL its `src` names. Only
  add it when you control the URL.
- **Loading Atlas itself.** Pin an exact version and, from a CDN, use the integrity hash from the
  release notes (see [Getting started](getting-started.md#pin-a-version)).

## Content Security Policy

Atlas uses no `eval`, no `new Function` and no inline event handlers. It inserts a `<style>` element
into its shadow root, so a policy that restricts styles needs `style-src 'unsafe-inline'` for Atlas
to render correctly. (Positions and sizes are set through the CSSOM, which Content Security Policy
does not restrict.) This has not been tested against a strict policy yet.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
