# Open-source and commercial strategy

## Trust contract

Retain the existing MIT license. Keep release automation, deterministic analysis,
service catalog, baseline monitoring, incident workflows, self-hosting, APIs and
data export in the free open-source product. Do not relicense existing code,
introduce payment gates, require cloud accounts or withhold essential recovery.
This is a strategic commitment for this plan, not an assertion that every future
component has already been built or legally committed forever.

Publish small reviewed changes, version data contracts, document migrations and
security boundaries, and keep a tested self-host path. Accept bug reports with
reproductions, publish evidence at its real scope, and never send telemetry by
default. A developer should be able to leave with their operational history.

## What hosting could sell

Managed operation: reliable multi-region checks, upgrades, backups, storage and
retention, availability, team administration, alert delivery, support and managed
collector infrastructure. Customers pay for operational responsibility and saved
time. Avoid selling trust back to users by artificially degrading correctness in
the free product. Packaging and prices require customer evidence; no billing code
or commercial restrictions belong in this iteration.

## Costs to watch

Frequent probes scale with monitor count × frequency × regions. Error payloads,
logs, indexed high-cardinality attributes and long retention can overwhelm an
early business. SMS/voice alerts, egress, source-map processing and support have
real variable costs. Set explicit payload limits, retention and concurrency now;
add per-tenant quotas before any shared service. Do not promise unbounded free
telemetry or an SLA the project cannot sustain.

## Validate before increasing investment

Recruit a few willing maintainers through public documentation and opt-in
conversations; no outreach is performed by this plan. Observe whether they can
install without help, import a release, detect a controlled failure and recover.
Track setup friction, workflow completion, repeat use, investigation effort and
alert usefulness with consent, rather than vanity signups. Ask what operation
they would pay to delegate. Set a review after five independent installations;
this is a proposed learning gate, not a claim of adoption.

Contributor entry points: a reproducible monitor failure, a tested collector
adapter, accessibility improvements, migration fixtures and docs. Require a
contract and conformance tests for integration work. Publish an implementation
matrix so missing roadmap items cannot be mistaken for working capabilities.
