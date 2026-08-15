# @fettle/core

The maintenance-health grading engine behind [Fettle](https://github.com/rumankazi/fettle):
rules, scoring, the GitHub fetch layer, and report assembly.

```bash
pnpm add @fettle/core
```

```ts
import { assess, renderMarkdown } from '@fettle/core';

const report = await assess(['acme/api', 'acme/web'], { token: process.env.GITHUB_TOKEN });

console.log(report.fleet.averageScore);
console.log(renderMarkdown(report));
```

`assess` fetches, configures and scores. `assessContext` scores a `RepoContext` you
already have, with no network involved.

Full documentation, the scoring math, and the report schema:
[github.com/rumankazi/fettle](https://github.com/rumankazi/fettle).
