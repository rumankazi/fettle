<!-- The title of this pull request becomes the commit subject on main and drives
     the next release, so it must be a Conventional Commit:

       feat: ...   minor bump      fix: ...     patch bump
       feat!: ...  major bump      docs: ...    no release

     See CONTRIBUTING.md#commits-and-pull-requests. -->

## What and why

<!-- What changes, and what problem it solves. The diff already says what; tell us why. -->

## Checklist

- [ ] `pnpm build && pnpm test && pnpm lint && pnpm typecheck` pass
- [ ] Tests cover the change (for a rule: pass, fail, `na`, threshold boundaries)
- [ ] `README.md` updated if behaviour changed
- [ ] `DECISIONS.md` entry if this deviates from SPEC/ARCHITECTURE/SCORING
- [ ] Rebuilt `packages/action/dist/index.js` committed, if the Action changed

## Score impact

<!-- Does this change the grade an unchanged repository would get? A new rule that
     is enabled by default does, and needs a `!` on the title for a major release.
     Delete this section if not. -->
