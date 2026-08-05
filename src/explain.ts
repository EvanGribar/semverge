import { bumpForChange } from "./changes.js";
import type { ReleasePlan } from "./types.js";

function bumpLabel(bump: ReleasePlan["bump"]): string {
  return bump === "none" ? "no version bump" : `${bump} release`;
}

export function explainReleasePlan(plan: ReleasePlan): string {
  const lines = [
    "SemVerge release explanation",
    "",
    `Version decision: ${plan.previousVersion} -> ${plan.version} (${bumpLabel(plan.bump)}).`,
    `Release channel: ${plan.channel}${plan.promotion ? ` (promoted from ${plan.previousVersion})` : "."}`
  ];

  if (!plan.hasRelease) {
    lines.push("Why: no release-worthy changes were found.");
  } else {
    lines.push("Why:");
    if (plan.promotion) {
      lines.push("- The prerelease was explicitly promoted to the stable channel.");
    }
    for (const change of plan.releaseChanges) {
      const changeBump = bumpForChange(change);
      const scope = change.scope ? ` [${change.scope}]` : "";
      lines.push(`- ${change.title}${scope}: ${bumpLabel(changeBump)}${change.breaking ? "; breaking change" : ""}.`);
    }
  }

  if (plan.skippedChanges.length > 0) {
    lines.push("Skipped:");
    for (const change of plan.skippedChanges) {
      lines.push(`- ${change.title}: excluded by release metadata or labels.`);
    }
  }

  lines.push("", `Readiness: ${plan.readiness.passed ? "ready" : "blocked"}.`);
  if (!plan.readiness.passed) {
    if (plan.readiness.missingLabels.length > 0) lines.push(`- Missing labels: ${plan.readiness.missingLabels.join(", ")}.`);
    if (plan.readiness.missingFiles.length > 0) lines.push(`- Missing files: ${plan.readiness.missingFiles.join(", ")}.`);
    if (plan.readiness.failedCommands.length > 0) lines.push(`- Failed checks: ${plan.readiness.failedCommands.join(", ")}.`);
    if (plan.readiness.missingTasks.length > 0) lines.push(`- Missing tasks: ${plan.readiness.missingTasks.join(", ")}.`);
  }

  if (plan.pluginInvocations && plan.pluginInvocations.length > 0) {
    lines.push("", "Plugins:");
    for (const inv of plan.pluginInvocations) {
      lines.push(`- ${inv.plugin}: ${inv.result.blocked ? "blocked" : "executed"}${inv.result.summary ? ` (${inv.result.summary})` : ""}`);
    }
  }

  lines.push("", "When merged:");
  if (plan.hasRelease) {
    lines.push(
      "- SemVerge verifies the merge commit and prepares the release outputs.",
      "- It builds configured artifacts, records a durable transaction, and publishes configured packages and releases idempotently.",
      "- Post-release verification records whether the transaction completed or needs recovery."
    );
  } else {
    lines.push("- SemVerge does not create a release PR until a release-worthy change is present.");
  }

  lines.push("", "Recovery:", "- If publication is interrupted, run `semverge recover <release-id>` to inspect the durable state and safe next action.");
  return lines.join("\n");
}
