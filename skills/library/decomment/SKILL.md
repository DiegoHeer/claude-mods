---
name: decomment
description: Re-review comments in just-written code and cut the noise. Use when the user runs /decomment, or says "clean up the comments", "remove verbose comments", "decomment", or asks to trim over-commented code. Applies to comments added this session by default; honors an optional path argument.
---

# Decomment

Re-evaluate the comments in recently written code. Delete what isn't
necessary; shorten what stays to one line focused on WHY, not WHAT.

## Target

- **No argument** â†’ the comments in code changed this session. Get the
  set from `git diff` against the session's starting point; fall back
  to unstaged/uncommitted changes (`git diff HEAD`).
- **A path argument** (`/decomment src/foo.ts`) â†’ comments in that
  file or directory.

## The test â€” apply to every comment

**Delete it** when it:
- narrates the next line or restates a name (`// loop over items`, `// set the flag`)
- states the obvious from the code itself
- is commented-out code, or a TODO with no owner or context

**Keep it â€” then shorten to one line** when it:
- explains WHY a non-obvious choice was made
- warns of a consequence that isn't visible locally
- cites an external constraint (a spec, a bug number, an API quirk)
- flags a deliberate simplification or known ceiling

A kept comment that spans several lines and only needed one â†’ rewrite
it to that one line. WHY, not WHAT.

When genuinely unsure whether a comment is load-bearing â†’ keep it. The
bias is toward cutting noise, never toward stripping intent.

## Leave alone

Structured API documentation â€” docstrings, JSDoc/TSDoc, `///` / `//!`
doc comments. Touch these only when they purely restate the signature.

## Do it

Apply the edits directly. Then report one terse summary, grouped by
file: `N removed, M shortened`. The changes land in the diff for review.
