# Runbook — Claude auto review

> **When you need this:** the auto review stopped commenting on PRs, or you are about to edit
> `.github/workflows/claude-auto-review.yml` and want to know why your change appears to do nothing.

## What the workflow does

`.github/workflows/claude-auto-review.yml` runs `anthropics/claude-code-action@v1` against a PR and
asks it to post its findings with `gh pr comment` and
`mcp__github_inline_comment__create_inline_comment`. It fires on `pull_request`
(`opened`/`synchronize`), on an `@claude` comment from a trusted maintainer, and on
`workflow_dispatch` with an explicit PR number.

## The review must finish inside one agent turn

The Actions job is torn down the moment the agent's turn ends. Anything the agent leaves running in
the background is killed before it can post, and the job still reports **success** - so a silent
non-review looks identical to a clean review that found nothing.

This is not hypothetical. Reviews were intermittently posting nothing because the agent delegated to
the bundled `/code-review` skill, which fans the work out into background subagents and returns
immediately. A failing run's own output showed `spawned 5, started_in_background 5, completed 0`,
the agent's result text said it would "report back once it completes", and the post step logged
`No buffered inline comments`. Runs that reviewed the diff inline in the same turn posted fine,
which is why the failure looked random: small diffs got reviewed directly, large ones tempted the
agent into the background path.

The guard is in `claude_args`:

```
--disallowedTools "Agent,Task"
```

`Agent` is the subagent-spawn tool and `Task` is its older name; both are listed so the guard cannot
silently no-op if the runtime uses the other identifier. Disallowing a name the runtime does not
know is harmless. The bare name (no parentheses) matches every subagent type, and deny beats allow
in the permission evaluation order, so background fan-out is impossible regardless of what the agent
decides. Replace it only with an equally deterministic guard, and do not downgrade it to a prompt
instruction telling the agent to stay synchronous: one was authored in `871455e` on
`claude/fix-ci-review-sync` but never reached `main`, because PR #273 restored the workflow to the
main-branch version instead. So nothing here establishes that a prompt alone holds, and the failure
it would be guarding against is silent.

## Editing this workflow self-skips the review on your own PR

`claude-code-action` validates the workflow file against the copy on the default branch and refuses
to run when they differ, which stops a PR from rewriting the review workflow and running it beside
this repo's secrets. On a PR that touches `claude-auto-review.yml` you will see the step finish in a
few seconds with:

```
Skipping action due to workflow validation: Workflow validation failed. The workflow file must
exist and have identical content to the version on the repository's default branch.
```

That is a no-op **success**, not a failure, and it is expected. Consequences:

- A PR that edits this workflow cannot auto review itself.
- A `workflow_dispatch` from the feature branch is equally a no-op, so it cannot prove a change
  works. The change is only exercised once it is merged to `main`.
- To verify a change, merge it and then watch the next PR that does **not** touch this workflow.

## Checking whether a review actually happened

A green job is not evidence. Open the run's log for the `Run anthropics/claude-code-action@v1` step
and check:

- **Duration.** A real review takes minutes. A few seconds means it self-skipped (see above) or
  exited early.
- **`terminal_reason` / `result`.** The agent's own result text says what it did. Treat any promise
  to "report back" as a non-review.
- **`subagent_stats`.** Anything other than zero spawned means work was pushed into the background.
- **The post step.** `No buffered inline comments` alongside a claim that comments were posted means
  nothing was posted.

`show_full_output: true` is deliberately on so denied tools and the agent's transcript stay visible
in the run log.

## Paths that will not review

- **Fork PRs on the automatic path.** GitHub withholds secrets from fork `pull_request` runs, so the
  "Refuse un-requested fork PRs" step fails the job with a clear error instead of an empty-token
  failure. A trusted maintainer can still review a fork PR on demand by commenting `@claude` or via
  `workflow_dispatch`; those paths gate on the maintainer rather than the PR author.
- **Dependabot PRs.** Their `author_association` is `CONTRIBUTOR`, so they do not match the actor
  gate and are skipped silently. Secrets are withheld from Dependabot runs anyway. Review dependency
  PRs by hand, or push one through `workflow_dispatch`.
