# Deploy status

How to find the target environment and prove the merge commit is live there.
Every command here is read-only.

## Find the environments

Look in this order, and stop when the picture is clear:

1. `.github/workflows/*.yml`: deploy jobs, their `environment:` keys, and their order
   (`needs:` chains, or separate workflows triggered by `workflow_run`).
2. ArgoCD manifests: `Application` or `ApplicationSet` files, often under `argocd/`,
   `deploy/`, `k8s/` or a separate GitOps repo named in the workflows. One app per
   environment is common. Note each app's name, `targetRevision`, and where the image
   tag is set (Kustomize overlays, Helm values).
3. `deploy*` scripts, `Makefile` targets, and the README.

From that, write down the environments in promotion order, for example
`dev → acc → prod`, and which deploy job or ArgoCD app belongs to each. A job without an
`environment:` key gets its environment from its name or the URL it deploys to.

The target is `--env` if the user gave it. Otherwise it is the first environment in that
order where the merge commit is live. If it is live nowhere yet, it is not live: say the
state of the first environment.

Use the full merge commit SHA in every command
(`gh pr view <n> --json mergeCommit --jq .mergeCommit.oid`).

**Is it production?** Treat an environment as production when its name is `prod`,
`production`, `prd` or `live`, when its GitHub environment has protection rules
(`gh api repos/{owner}/{repo}/environments/{name}`), or when you cannot tell (names like
`main`, or a single unnamed environment). Only an explicit "this is a test environment"
from the user turns an unclear one into a test environment.

## CI/CD

```bash
gh run list --commit <merge-sha> --json databaseId,workflowName,status,conclusion
gh run view <id> --json jobs --jq '.jobs[] | {name, status, conclusion}'
```

Live on an environment = the deploy job for that environment is `completed` with
`success` for the merge commit.

- `in_progress` or `queued`: still deploying. Not live.
- `failure` or `cancelled`: the deploy failed. Not live; say which job failed.
- No run for the merge commit: the deploy may be manual, or a newer commit carried it.
  Check whether a later successful deploy run's commit contains the merge
  (`git merge-base --is-ancestor <merge-sha> <deployed-sha>`).

## ArgoCD

```bash
argocd app get <app> -o json
# or, without the argocd CLI:
kubectl get application <app> -n argocd -o json
```

Live = all three:

- `.status.sync.status` is `Synced`
- `.status.health.status` is `Healthy`
- `.status.sync.revision` contains the merge commit
  (`git merge-base --is-ancestor <merge-sha> <revision>`), or the running image tag
  (`.status.summary.images`) is the tag CI built for the merge commit

`Progressing`, `OutOfSync`, or an older revision: not live yet. Say which one.

When the GitOps repo is separate, the app revision is a commit in that repo. Find the
commit there that bumped the image tag to the merge build, then compare.

## Previous deployed commit

Only for `--deploy`. You need the commit that was live on the target before this deploy.

- CI/CD: `gh run list --workflow <deploy-workflow> --status success --limit 2 --json headSha`;
  the second entry is the previous deploy.
- ArgoCD: `.status.history` in the app JSON; the second-to-last entry's `revision`.

The PRs in the deploy are the merged PRs between the two commits:

```bash
git log --merges --first-parent --format='%H %s' <old-sha>..<new-sha>
```

Squash-merged PRs have no merge commit; then use `git log --format='%H %s' <old>..<new>`
and read the `(#123)` suffix. If the previous commit cannot be found, ask the user for
the range.
