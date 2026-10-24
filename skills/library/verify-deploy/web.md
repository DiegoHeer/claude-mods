# Web checks

How to check a web UI change on the deployed environment.

## Reuse the repo's tests first

If an end-to-end test covers the changed screen, run only that test against the deployed
URL:

- **Playwright**: `BASE_URL=<url> npx playwright test <spec> --grep '<test name>'`.
  Check `playwright.config.*` for the variable it reads (`baseURL`, often from
  `process.env.BASE_URL` or `PLAYWRIGHT_BASE_URL`).
- **Cypress**: `npx cypress run --spec <spec> --config baseUrl=<url>`.

Do not run the whole suite. Read the spec before you run it: if it submits, saves, signs
up or deletes anything, the check is `[changes data]`. If the test only checks that the
page loads, add a browser check for the changed behavior.

## Browser checks

If no test covers it, drive a browser. Find the browser tool in the session with
ToolSearch (search for `browser` or `chrome`). Then:

1. Open the deployed URL of the changed page. Find its path from the router files or the
   page component in the diff.
2. Do what the PR changed: click, fill, submit.
3. Read the DOM or the visible text to confirm the result.
4. Take a screenshot after the key step. Save it in a temp directory and give the path
   as proof.
5. Read the browser console. A new error on the changed page is a failed check.

If no browser tool is available, put the check on the manual list with the exact clicks.

## Side effects

Pick one or two neighbors from the diff: another page that uses the changed component,
the same form with the old input, or the same page at a narrow (mobile) width when the
diff changes layout.

## Writing data

Actions that save something (submit a form, add to a cart, create an account) change
data. Do them only on a test environment and only when the approved proposal marks the
check `[changes data]`. Never complete a real payment, send a real message or email, or
delete data you did not create. Stop one step before, and check that step instead.

## Logins

If the page needs a login:

- Ask the user to log in in the browser window, then go on.
- Use test credentials only if the repo documents them for this environment.

Never type a password into the report.
