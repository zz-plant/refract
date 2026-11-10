# @refract-org/persistence

SQLite persistence layer. Uses `bun:sqlite` — Bun only.

```bash
bun add @refract-org/persistence
```

## Exports

### Class

- `Persistence` — full CRUD for revisions and claims

### Interface

- `PersistenceAdapter` — `insertRevision`, `insertRevisions`, `getRevisions`, `hasRevision`, `insertClaim`, `getClaims`, `close`

```ts
import { Persistence } from "@refract-org/persistence";
import type { PersistenceAdapter, PersistenceConfig } from "@refract-org/persistence";
```

[Refract](https://github.com/refract-org/refract) · [Docs](https://zz-plant.github.io/refract/)
