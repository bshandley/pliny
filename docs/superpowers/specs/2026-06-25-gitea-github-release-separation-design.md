# Gitea/GitHub release separation

- Date: 2026-06-25
- Status: Approved
- Repo: `pliny` (Gitea `bradley/pliny`, GitHub `bshandley/pliny`)

## Context

Pliny lives canonically in Gitea and mirrors to GitHub. Until now both
remotes' `main` were kept byte-identical by manual dual-push, so every
Gitea commit reached the public repo immediately. There was no release
gate: dev work, WIP, and intermediate states were all public the moment
they were pushed.

The goal is a clean separation of roles:

- Gitea is for iteration and development, with automated deployment
  (deploy already exists outside this repo and watches Gitea `main`).
- GitHub is for public release: it should only ever show deliberate,
  stable, buildable releases, not the day-to-day dev line.

## Decisions

1. No redaction. GitHub gets identical file content to Gitea, just less
   often. A public release is a snapshot of Gitea at a chosen point. The
   retired internal files on the dead `master` branch stay retired.
2. Release-branch model (not tag-based trigger, not manual publish).
3. Deployment is out of scope. It already works and watches Gitea `main`;
   this design does not touch it. Dev therefore stays on `main`.
4. Inbound public contributions are pulled into Gitea `main` and closed on
   GitHub. Gitea `main` is the single source of truth; the public branch
   never receives direct merges.

## Topology

| Branch | Role | Visibility |
| --- | --- | --- |
| Gitea `main` | development line, auto-deploys on push | private |
| Gitea `release` | curated public state, advanced from `main` at release time | private |
| GitHub `main` | exact mirror of Gitea `release` | public |

Gitea `main` (dev) is never pushed to GitHub. The public only ever sees
released content, on GitHub `main`. GitHub keeps `main` as its default
branch (public convention; contributors branch from `main`). There is no
`release` branch on GitHub.

## Release procedure

The deliberate public-release action:

```
git checkout release
git merge --ff-only main          # release is always an ancestor of main, so this is always clean
git tag vX.Y.Z                    # optional but recommended: enables versioned GHCR images
git push github release:main      # advances public GitHub main
git push github vX.Y.Z            # only if tagged
git checkout main                 # back to dev
```

The push to GitHub `main` fires the existing `.github/workflows/docker-publish.yml`,
which publishes images to GHCR (`latest`, plus the semver tag when present).
That workflow is guarded with `if: github.server_url == 'https://github.com'`,
so it never runs on Gitea even if a Gitea Actions runner exists. No CI
changes are needed.

## Inbound PR flow

External contributions arrive as PRs against GitHub `main`. They do not get
merged on GitHub. Instead:

```
git fetch github pull/N/head:pr-N
git checkout main
git merge --squash pr-N           # author = contributor, committer = Bradley Handley <bradley@handley.io>
# resolve lockfile conflicts by regenerating: rm package-lock.json && npm install
# build to verify (the repo has no CI gate), then:
git push origin main
gh pr close N -R bshandley/pliny --comment "merged into main as <sha>, ships in the next release"
```

The change goes public at the next release. Squash means GitHub shows the
PR as closed (not "merged"); the close comment provides the commit link.

## One-time setup

```
git branch release bda047a        # current tip; already equals GitHub main
git push origin release
```

Everything starts aligned: Gitea `main`, Gitea `release`, and GitHub `main`
all at `bda047a`. The public face does not move until the first deliberate
release.

## Safeguards

- In the local clone, set `remote.github.push = release:main` so a bare
  `git push github` can only ever map Gitea `release` to public `main`,
  never dev `main`. Releases use the explicit command above.
- Optional hardening: a Gitea branch-protection rule on `release` that only
  allows it to advance by fast-forward from `main` (no direct commits).

## Edge cases and non-goals

- Hotfixes go through Gitea `main` then a release, like any other change.
  No direct commits on `release`, which keeps `--ff-only` always valid and
  Gitea `main` authoritative.
- The dead `master` branch stays retired as-is; not deleted here.
- `pliny-marketing` publishing to GitHub remains parked (separate decision).
- Doc visibility: because there is no redaction, files committed to Gitea
  `main`, including this `docs/superpowers/` tree, become public at the next
  release. That is acceptable for this design doc. If future internal docs
  should stay private, that is a separate decision that would reintroduce a
  narrow path-based redaction.

## Success criteria

- Pushing to Gitea `main` all day produces nothing public.
- A public release is one deliberate, repeatable action.
- GitHub `main` is always a released, buildable state.
- External PRs have a clear, documented path back into Gitea `main`.
