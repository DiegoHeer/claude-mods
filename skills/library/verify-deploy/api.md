# API checks

How to check an API change on the deployed environment.

## Reuse the repo's requests first

Look for request collections that already cover the changed endpoints:

- **Bruno**: a collection is a folder with `bruno.json`; its environments are in
  `environments/*.bru` inside it. From the collection folder, run only the folder or
  files that cover the change: `bru run <folder-or-file> --env <env>`.
- **Postman**: `*.postman_collection.json` and `*.postman_environment.json`. Run with
  `newman run <collection> -e <environment> --folder <folder>`.
- **HTTP files**: `*.http` / `*.rest`. Use them as the source for `curl` calls.

Pick the environment that matches the target (`staging.bru`, `acc.bru`, ...). If none
matches, ask the user.

Read the requests before you run them. Any request that is not a GET makes the check
`[changes data]`. On production, run read-only files one by one instead of a folder that
mixes them with writes.

A collection that passes is proof only if its asserts check the changed behavior. If it
only checks the status code, add a `curl` check for the changed field.

## Own checks with curl

```bash
curl -sS -o <tmp>/body.json -w '%{http_code}\n' -H 'Accept: application/json' '<base-url>/<path>'
jq -e '(.items | length > 0) and all(.items[]; .status == "active")' <tmp>/body.json
```

Assert on what the PR changed, not only on the status. Make sure the data is not empty
first: an empty list passes any `all(...)` check.

Find the base URL and auth in the repo: Bruno / Postman environments, `.env.example`,
Helm values, ingress manifests, README. Ask if it is not there. If the API needs a token
and the repo shows no way to get one for this environment, ask the user for one, or put
the check on the manual list.

## Side effects

Pick one or two neighbors from the diff:

- the same endpoint without the new parameter or with the old input
- other endpoints that call the changed function or share the changed model
- consumers of a changed response field, if the repo shows them

## Logs

Check for new errors after the checks ran:

```bash
kubectl logs deploy/<name> -n <namespace> --since=10m | grep -iE 'error|exception|panic'
gcloud logging read 'resource.labels.container_name="<name>" AND severity>=ERROR' --freshness=10m
aws logs tail <log-group> --since 10m --filter-pattern ERROR
```

Use the one that matches where the repo deploys.

## Writing data

Only on a test environment, and only for checks marked "changes data" in the approved
proposal. Name test data so it is easy to find, for example a `verify-deploy-` prefix.
Delete it after the checks. If you cannot, say what is left in the report.

## Secrets

Follow "Secrets" in `SKILL.md`. Do not use `curl -v` output as proof.
