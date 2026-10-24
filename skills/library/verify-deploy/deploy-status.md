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
order where the merge commit is live, or is deploying now. If it is neither on any
environment, it is not live: say the state of the first environment.

With `--deploy`, the target is `--env`, else the first environment in promotion order.
There, the "merge commit" in the checks below is the commit deployed now.

Run `git fetch origin` first, so the merge commit and the deployed commits exist locally.
Use the full merge commit SHA in every command
(`gh pr view <n> --json mergeCommit --jq .mergeCommit.oid`).

**Is it production?** Treat an environment as production when its name is `prod`,
`production`, `prd` or `live`, when its GitHub environment has protection rules
(`gh api repos/{owner}/{repo}/environments/{name}`), or when you cannot tell (names like
`main`, or a single unnamed environment). Only an explicit "this is a test environment"
from the user turns an unclear one into a test environment.

## Still deploying: wait

When the deploy to the target is still running, wait for it to finish, then check again.
Tell the user you are waiting and for what. Run the wait as a background command so it
does not hit the tool time limit, and stop waiting after 30 minutes.

- CI/CD: `gh run watch <id> --exit-status`
- ArgoCD: `argocd app wait <app> --sync --health --timeout 1800`
  (without the CLI, re-read the Application status every minute)

After the wait, run the live check again. Still not live after 30 minutes, or the deploy
failed: stop and say what is missing.

## CI/CD

```bash
gh run list --commit <merge-sha> --json databaseId,workflowName,status,conclusion
gh run view <id> --json jobs --jq '.jobs[] | {name, status, conclusion}'
```

Live on an environment = both:

- the deploy job for that environment is `completed` with `success` for the merge
  commit, or for a later commit that contains it
- the latest successful deploy to that environment still contains the merge, so it was
  not rolled back:
  `gh run list --workflow <deploy-workflow> --branch <deploy-branch> --status success --limit 10 --json databaseId,headSha`,
  take the newest run whose target job succeeded, then
  `git merge-base --is-ancestor <merge-sha> <its-headSha>` (exit 0 = contains it)

Other job states:

- `in_progress`, `queued`, `waiting` or `pending`: still deploying. Wait (see above).
- `failure`: the deploy failed. Not live; say which job failed.
- `cancelled`: often a newer run replaced it (`concurrency: cancel-in-progress`). Check
  whether a later run that contains the merge succeeded or is running. If not, not live.
- `skipped`: the job did not run for this commit, for example a manual gate. Not live
  on that environment; say so.
- No run for the merge commit: the deploy may be manual, or a newer commit carried it.
  Use the rollback check above to see whether the latest deploy contains the merge.

## ArgoCD

```bash
argocd app get <app> -o json
# or, without the argocd CLI:
kubectl get application <app> -n argocd -o json
```

Live = all three:

- `.status.sync.status` is `Synced`
- `.status.health.status` is `Healthy`
- `.status.sync.revision` (or each of `.status.sync.revisions[]` for multi-source apps)
  contains the merge commit (`git merge-base --is-ancestor <merge-sha> <revision>`), or
  the running image tag (`.status.summary.images`) is the tag CI built for the merge
  commit

`Progressing`, or `OutOfSync` with a sync running (`.status.operationState.phase` is
`Running`): still deploying. Wait (see above). `Degraded`, a failed sync, or an older
revision with no sync running: not live. Say which one.

When the GitOps repo is separate, the app revision is a commit in that repo. Find the
commit there that bumped the image tag to the merge build, then compare.

## Previous deployed commit

Only for `--deploy`. You need the commit that was live on the target before this deploy.

- CI/CD: list successful runs of the deploy workflow on the deploy branch
  (`gh run list --workflow <deploy-workflow> --branch <deploy-branch> --status success --limit 20 --json databaseId,headSha`).
  Keep only runs where the target environment's job succeeded. The previous deploy is the
  first `headSha` that differs from the current one.
- ArgoCD: `.status.history` in the app JSON, newest last. The previous deploy is the last
  entry whose `revision` differs from the current one. With a separate GitOps repo, these
  revisions are GitOps commits: read the image tag each one set, and map the tag back to
  the app commit CI built it from.

The PRs in the deploy come from every commit between the two:

```bash
git log --format='%H' <old-sha>..<new-sha>
gh api repos/{owner}/{repo}/commits/<sha>/pulls --jq '.[] | select(.merged_at) | .number'
```

This works for merge, squash and rebase merges. Keep each PR number once. If the previous
commit cannot be found, ask the user for the range.
