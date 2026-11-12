# Source change review

Report: ea92f60f7e19c3a181b7a23cb7917cd7211f273becd2a9bc2907477696a531e2
Analyzer: 0.6.1; scope: article revisions only.

## Rivergate Library (fictional)

Status: pending. Reviewed revision: none; fetched: 5; source head: 5.

Coverage: complete; 5 revisions (1 → 5).

Fictional sample: dates, revision IDs, and URLs are illustrative. Inspect inputRevisions in the saved JSON report.

9 shown; 0 hidden by filters. Acknowledgment covers all revisions and events in the unfiltered saved report.

### section_reorganized — (lead)

2025-01-02T12:00:00Z · fictional revisions 1 → 2

Before:

```text
Rivergate Library is open until six every weekday throughout the year.<ref>{{cite web|url=https://example.org/rivergate/hours|title=Rivergate opening hours}}</ref>

The library provides free printing for all registered members.

The reading room has space for thirty seated visitors.
```

After:

```text
Rivergate Library is open until eight every weekday throughout the year.<ref>{{cite web|url=https://example.org/rivergate/hours|title=Rivergate opening hours}}</ref>

The library provides free printing for all registered members.

The reading room has space for thirty seated visitors.
```

### sentence_modified — (lead)

2025-01-02T12:00:00Z · fictional revisions 1 → 2

Before:

```text
Rivergate Library is open until six every weekday throughout the year
```

After:

```text
Rivergate Library is open until eight every weekday throughout the year
```

### citation_removed — (lead)

2025-01-03T12:00:00Z · fictional revisions 2 → 3

Before:

```text
<ref>{{cite web|url=https://example.org/rivergate/hours|title=Rivergate opening hours}}</ref>
```

After:

```text
(empty)
```

### section_reorganized — (lead)

2025-01-03T12:00:00Z · fictional revisions 2 → 3

Before:

```text
Rivergate Library is open until eight every weekday throughout the year.<ref>{{cite web|url=https://example.org/rivergate/hours|title=Rivergate opening hours}}</ref>

The library provides free printing for all registered members.

The reading room has space for thirty seated visitors.
```

After:

```text
Rivergate Library is open until eight every weekday throughout the year.

The library provides free printing for all registered members.

The reading room has space for thirty seated visitors.
```

### template_removed — body

2025-01-03T12:00:00Z · fictional revisions 2 → 3

Before:

```text
(empty)
```

After:

```text
cite web
```

### section_reorganized — (lead)

2025-01-04T12:00:00Z · fictional revisions 3 → 4

Before:

```text
Rivergate Library is open until eight every weekday throughout the year.

The library provides free printing for all registered members.

The reading room has space for thirty seated visitors.
```

After:

```text
Rivergate Library is open until eight every weekday throughout the year.

The reading room has space for thirty seated visitors.
```

### sentence_removed — (lead)

2025-01-04T12:00:00Z · fictional revisions 3 → 4

Before:

```text
The library provides free printing for all registered members
```

After:

```text
(empty)
```

### section_reorganized — (lead)

2025-01-05T12:00:00Z · fictional revisions 4 → 5

Before:

```text
Rivergate Library is open until eight every weekday throughout the year.

The reading room has space for thirty seated visitors.
```

After:

```text
Rivergate Library is open until eight every weekday throughout the year.

The library provides free printing for all registered members.

The reading room has space for thirty seated visitors.
```

### sentence_reintroduced — (lead)

2025-01-05T12:00:00Z · fictional revisions 4 → 5

Before:

```text
(empty)
```

After:

```text
The library provides free printing for all registered members
```

After inspecting the saved report: refract review --state-dir './review-state' --ack ea92f60f7e19c3a181b7a23cb7917cd7211f273becd2a9bc2907477696a531e2
