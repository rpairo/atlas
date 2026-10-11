# Security policy

## Supported versions

Only the latest minor release gets security fixes. While Atlas is 0.x, that is the newest 0.Y.Z.

## Reporting a vulnerability

Please do not open a public issue. Report it privately through
[GitHub's private vulnerability reporting](https://github.com/rpairo/atlas/security/advisories/new),
with a board or page that shows the problem if you can.

Atlas is maintained by one person in their own time, so there is no guaranteed response time, but
private reports are read first. Once a fix is released, the advisory is published with credit to
you unless you prefer otherwise.

## Scope

Atlas is meant to render boards from sources you do not fully trust.
[docs/security.md](docs/security.md) lists what it guarantees (no HTML from the data, no
prototype pollution, bounded work, same-origin boards) and what stays the page's responsibility.
A way to break one of those guarantees is a vulnerability.
