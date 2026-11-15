# Competitive context and product thesis

Research checked against official documentation on 2026-11-02. Capabilities below
are established product behavior, not claims that semverge has invented them.

| Product | Established capability | Implication for semverge |
| --- | --- | --- |
| Sentry | Releases, release health and suspect commits connect software changes to exceptions. | Release correlation is table stakes, not a novel feature. Preserve exact source and evidence provenance. |
| Better Stack | Monitors create incidents; acknowledgement, escalation and resolution support response. Catalog metadata supports service routing. | A monitor list without history and a usable incident lifecycle is insufficient. Compete on a bounded workflow before breadth. |
| PostHog | Releases bind deployment metadata and artifacts to stack traces, with source links. | A shared schema is useful only when it answers an actual debugging question. Error ingestion and source maps are substantial future work. |
| Linear | GitHub PR/commit linking and status automation connect engineering work. | Follow coherent navigation, explicit status and ownership. Do not rebuild a general issue tracker. |

Sources:

- [Sentry releases](https://docs.sentry.io/product/releases/) and [Sentry developer guide](https://docs.sentry.io/pdfs/developer-quick-reference-guide.pdf).
- [Better Stack monitoring](https://betterstack.com/docs/uptime/monitoring-start/), [incident lifecycle](https://betterstack.com/docs/uptime/working-with-incidents/), and [catalog metadata](https://betterstack.com/docs/uptime/incident-metadata/).
- [PostHog releases](https://posthog.com/docs/error-tracking/releases).
- [Linear GitHub integration](https://linear.app/docs/github-integration).

## Opportunity to validate

The thesis is a continuous path from **release intent and readiness → what shipped
→ observed impact → response → verified recovery → preventive work**. Semverge's
existing publication transaction can contribute evidence from before and during
shipping, rather than beginning only when an error arrives.

This is a positioning hypothesis, not a demonstrated competitive moat. Temporal
proximity is correlation, not causation. Never label the last release as the cause
of an incident simply because it was imported or published most recently. A
release can be explicitly linked to a service/environment and an incident; the
operator must be able to inspect the basis of that association.

Initially serve maintainers and small teams operating a few services who value
open deployment, understandable state and low overhead. Validate whether the
connected workflow reduces investigation effort before investing in high-volume
telemetry, automated remediation, or a large integration catalog. AI is neither
the differentiator nor required to operate this foundation.
