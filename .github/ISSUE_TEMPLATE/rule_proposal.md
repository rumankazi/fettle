---
name: Rule proposal
about: Propose a new maintenance-health check
labels: rule-proposal
---

Whether a rule belongs is a product question. `SPEC.md` keeps the set deliberately
small and lists what was excluded and why, so please make the case before building.

**The question this rule answers**
<!-- One sentence, in the form the README table uses. -->

**Why it signals maintenance health**
<!-- And why it is not security posture, which is Scorecard's job. -->

**How it would be measured**
<!-- Which API, and whether it fits the ~10 request per repository budget. -->

**Failure modes**
<!-- When would this be noisy or repository-dependent? What would make it `na`? -->

**Default**
<!-- Enabled or disabled? An enabled-by-default rule changes everyone's score and
     needs a major release. -->
