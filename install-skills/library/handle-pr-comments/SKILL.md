---
name: handle-pr-comments
description: "Fetch PR review comments, triage them (valid vs noise), plan fixes for valid ones, and implement. Use when a PR has review comments to address, someone says 'handle review comments', 'fix PR feedback', 'address review', or 'triage PR comments'."
argument-hint: "[PR number]"
user-invocable: true
---

# Handle PR Review Comments

Fetch review comments on a pull request, triage each one, plan fixes for valid comments, and implement them.

## Prerequisites

```bash
gh --version
gh auth status
```

## Workflow

### 1. Identify the PR

If `$ARGUMENTS` contains a PR number, use it. Otherwise auto-detect from the current branch:

```bash
gh pr view --json number,title,headRefName --jq '{number, title, branch: .headRefName}'
```

If no PR is found, stop and ask for a PR number.

Store the PR number, owner, and repo for subsequent API calls:

```bash
# Derive owner/repo from the git remote
gh repo view --json owner,name --jq '"\(.owner.login)/\(.name)"'
```

### 2. Fetch Review Comments

Fetch all review comments (inline code comments left during reviews):

```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments \
  --paginate \
  --jq '.[] | {id, user: .user.login, path, line: (.line // .original_line), side, body, created_at, in_reply_to_id, diff_hunk}'
```

Also fetch top-level review bodies for additional context:

```bash
gh api repos/{owner}/{repo}/pulls/{number}/reviews \
  --jq '.[] | {id, user: .user.login, state, body}'
```

Filter out:
- Comments authored by the PR author (self-comments are notes, not review feedback)
- Reply comments (`in_reply_to_id` is set) — read them for context but triage only root comments

### 3. Read the Current Code

For each unique file path referenced in the comments, read the current version of that file to understand the code context. Use the `diff_hunk` from each comment to locate the exact region under discussion.

### 4. Triage Each Comment

Classify every root review comment into one of these categories:

| Category | Meaning | Action |
|----------|---------|--------|
| **valid-bug** | Real bug, missing error handling, logic error | Must fix |
| **valid-improvement** | Meaningful improvement (a11y, perf, security, testability) | Should fix |
| **valid-test** | Missing or improved test coverage | Should fix |
| **already-addressed** | The code already handles this, or a subsequent commit fixed it | Dismiss with explanation |
| **disagree** | Suggestion is incorrect or would make code worse | Dismiss with rationale |
| **nitpick** | Pure style preference with no functional impact, already consistent with project conventions | Dismiss |
| **praise** | Positive feedback, acknowledgment | Dismiss |

For each comment, record:
- Comment ID and author
- File path and line
- Category (from table above)
- One-line reasoning for the classification
- For valid comments: what needs to change

### 5. Present Triage for Approval

Show the user a summary table:

```
## Triage Results — PR #<number>

### Valid (will fix)
| # | File | Line | Author | Category | Comment (truncated) | Planned Fix |
|---|------|------|--------|----------|---------------------|-------------|

### Dismissed
| # | File | Line | Author | Category | Reason |
|---|------|------|--------|----------|--------|
```

Ask the user:
1. Whether they agree with the triage (they may override any classification)
2. Whether to proceed with implementing fixes for all valid comments

Wait for explicit approval before making any code changes.

### 6. Plan the Fixes

For each valid comment, produce a concrete fix plan:

- **File**: exact path
- **What**: specific change (add attribute, wrap in component, add test case, etc.)
- **How**: brief description of implementation approach
- **Lines affected**: approximate line range

Group related fixes by file to minimize churn.

### 7. Implement the Fixes

Apply all planned fixes. Follow these rules:

- Work in the current worktree — do NOT create a new worktree or branch
- Make minimal, targeted changes — only what the review comments require
- Follow existing code style and conventions in each file
- Run relevant linters/formatters after changes if the project has them configured
- If a fix requires a new test, add it in the same test file convention the project uses

### 8. Verify

After implementing:

```bash
# Check for type errors (if TypeScript project)
npx tsc --noEmit 2>&1 | head -20

# Run affected tests (if identifiable)
# Use project-specific test runner
```

Report any failures and fix them before finishing.

### 9. Review & Push

After verification passes, pause for the user's review. Present the changes (files modified, diff summary) and wait for explicit sign-off before proceeding.

Once approved, commit and push:

```bash
git add -A
git commit -m "fix: address PR review comments"
git push
```

Group all review-comment fixes into a single commit unless they are logically unrelated (in which case use one commit per concern).

Do **not** respond to or resolve PR comments until the commit is pushed.

### 10. Respond & Resolve Comments

For each **fixed** comment (valid-bug, valid-improvement, valid-test), reply to the comment thread explaining what was done, then resolve the thread.

**Reply to the comment:**

```bash
gh api repos/{owner}/{repo}/pulls/{number}/comments/{comment_id}/replies \
  -f body="Fixed — <one-line description of what changed>."
```

**Resolve the thread:**

First, fetch the thread ID that contains the comment:

```bash
gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            comments(first: 1) {
              nodes { databaseId }
            }
          }
        }
      }
    }
  }
' -f owner="{owner}" -f repo="{repo}" -F number={number}
```

Match each fixed comment's ID to its thread, then resolve:

```bash
gh api graphql -f query='
  mutation($threadId: ID!) {
    resolveReviewThread(input: {threadId: $threadId}) {
      thread { isResolved }
    }
  }
' -f threadId="{threadId}"
```

For **dismissed** comments (already-addressed, disagree, nitpick): reply with the dismissal rationale but do **not** resolve — leave that to the reviewer.

For **praise** comments: no reply needed.

### 11. Summary

Present a final summary:

```
## Done — PR #<number> review comments addressed

### Fixed (<N> comments)
- <file>:<line> — <one-line description of fix> — replied & resolved ✅

### Dismissed (<N> comments)
- <file>:<line> — <category>: <reason> — replied ✅

### Verification
- Types: ✅/❌
- Tests: ✅/❌
```

## Edge Cases

- **Outdated comments** (on lines that no longer exist): Map to the closest current line using the `diff_hunk` context. If unmappable, classify as `already-addressed` and explain.
- **Bot comments** (Copilot, CodeRabbit, etc.): Triage normally — bots can surface valid issues. Note the author is a bot in the triage table.
- **Conflicting comments**: If two reviewers disagree, flag both and ask the user to decide.
- **Large comment volume** (>15 comments): Group by file and present triage in batches if needed.

## Rules

- **Never** implement fixes without showing the triage and getting approval first
- **Always** commit and push fixes before responding to comments — replies reference the fix commit
- **Never** dismiss valid feedback as noise — when uncertain, classify as valid
- **Always** read the actual current code before triaging (comments may reference outdated state)
- **Always** preserve the existing code style
- **Bias toward valid**: if a comment is borderline, classify it as valid-improvement rather than dismissing
