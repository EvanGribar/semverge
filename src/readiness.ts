import type { ReadinessConfig, ReadinessContext, ReadinessReport, ReleaseChange } from "./types.js";

export function evaluateReadiness(config: ReadinessConfig, changes: ReleaseChange[], context: ReadinessContext = {}): ReadinessReport {
  const availableLabels = new Set([...context.availableLabels ?? []].map((label) => label.toLowerCase()));
  const availableFiles = new Set(context.availableFiles ?? []);
  const missingLabels = config.requiredLabels.filter((label) => !availableLabels.has(label.toLowerCase()));
  const missingFiles = config.requiredFiles.filter((file) => !availableFiles.has(file));
  const commandResults = context.commandResults ?? {};
  const failedCommands = config.commands.filter((command) => commandResults[command.name] === false).map((command) => command.name);
  const requestedTasks = [...new Set(changes.flatMap((change) => change.readiness))];
  const missingTasks = requestedTasks.flatMap((taskName) => {
    const task = config.tasks.find((candidate) => candidate.name.toLowerCase() === taskName.toLowerCase());
    if (!task) {
      return [taskName];
    }
    const satisfiedByLabel = task.label ? availableLabels.has(task.label.toLowerCase()) : false;
    const satisfiedByFile = task.file ? availableFiles.has(task.file) : false;
    return satisfiedByLabel || satisfiedByFile ? [] : [taskName];
  });

  return {
    passed: missingLabels.length === 0 && missingFiles.length === 0 && failedCommands.length === 0 && missingTasks.length === 0,
    missingLabels,
    missingFiles,
    failedCommands,
    missingTasks,
    requestedTasks
  };
}

export function readinessMarkdown(report: ReadinessReport): string {
  const lines = [`## Readiness`, "", report.passed ? "✅ All configured release checks pass." : "⚠️ Release is waiting on required product work.", ""];
  if (report.missingLabels.length > 0) {
    lines.push(`- Missing labels: ${report.missingLabels.map((label) => `\`${label}\``).join(", ")}`);
  }
  if (report.missingFiles.length > 0) {
    lines.push(`- Missing files: ${report.missingFiles.map((file) => `\`${file}\``).join(", ")}`);
  }
  if (report.failedCommands.length > 0) {
    lines.push(`- Failed checks: ${report.failedCommands.map((command) => `\`${command}\``).join(", ")}`);
  }
  if (report.missingTasks.length > 0) {
    lines.push(`- Missing product tasks: ${report.missingTasks.map((task) => `\`${task}\``).join(", ")}`);
  }
  if (report.requestedTasks.length > 0) {
    lines.push(`- Requested product tasks: ${report.requestedTasks.map((task) => `\`${task}\``).join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}
