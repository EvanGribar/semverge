import type { CommunicationArtifact, CommunicationQualityFinding, CommunicationQualityReport, CustomerQualityConfig } from "./types.js";

interface QualityRule {
  id: string;
  message: string;
  pattern: RegExp;
}

const QUALITY_RULES: QualityRule[] = [
  {
    id: "conventional-commit-prefix",
    message: "raw conventional-commit syntax is implementation-facing",
    pattern: /(?:^|[\s([>*-])(?:feat|fix|chore|ci|build|refactor|revert|style|test|docs|perf)(?:\([^)]*\))?!?:\s+\S/gi
  },
  {
    id: "pull-request-reference",
    message: "pull-request references belong in technical traceability, not customer copy",
    pattern: /\b(?:pull request|pr\s*#\d+)\b|github\.com\/[^\s)]+\/pull\/\d+|\(#\d+\)/gi
  },
  {
    id: "commit-reference",
    message: "commit identifiers expose implementation traceability",
    pattern: /\b[0-9a-f]{7,40}\b/gi
  },
  {
    id: "versioning-language",
    message: "versioning mechanics are release-engine language",
    pattern: /\b(?:semver|semantic version(?:ing)?|version bump|(?:major|minor|patch)\s+(?:version|bump))\b/gi
  },
  {
    id: "release-engine-language",
    message: "release-engine or registry implementation terminology leaked into audience copy",
    pattern: /\b(?:idempotenc\w*|transaction(?:al)?|artifact digest|registry(?: publication)?|release planner|publication target)\b/gi
  },
  {
    id: "source-reference",
    message: "source or package paths are implementation detail",
    pattern: /\b(?:src|lib|dist|build|packages?|apps?|crates?)\/[A-Za-z0-9._/-]+/gi
  },
  {
    id: "implementation-identifier",
    message: "technical identifiers should be explained in user terms",
    pattern: /\b[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+\b/g
  },
  {
    id: "internal-framing",
    message: "release-engine framing is not customer-facing language",
    pattern: /\bHighest-impact change\b|\bThis release includes \d+ (?:feature|fix|breaking)/gi
  },
  {
    id: "technical-only-line",
    message: "the section contains only a technical identifier and no customer-readable outcome",
    pattern: /^\s*(?:[-*]\s*)?(?:[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+|[A-Za-z0-9._/-]+\.(?:ts|tsx|js|jsx|py|rs|json|lock))\s*$/gi
  }
];

const DEFAULT_CUSTOMER_QUALITY: CustomerQualityConfig = { mode: "warn", allowTerms: [] };

function excerpt(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

function allowed(line: string, allowTerms: readonly string[]): boolean {
  const normalized = line.toLowerCase();
  return allowTerms.some((term) => term.trim() && normalized.includes(term.trim().toLowerCase()));
}

function findingsFor(content: string, allowTerms: readonly string[]): CommunicationQualityFinding[] {
  const findings: CommunicationQualityFinding[] = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (allowed(line, allowTerms)) {
      continue;
    }
    for (const rule of QUALITY_RULES) {
      const match = [...line.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags))][0];
      if (match?.[0]) {
        findings.push({ rule: rule.id, message: rule.message, excerpt: excerpt(match[0]), line: index + 1 });
      }
    }
  }
  return findings;
}

export function lintCommunicationArtifact(content: string, artifact: CommunicationArtifact, config: CustomerQualityConfig = DEFAULT_CUSTOMER_QUALITY): CommunicationQualityReport {
  if (config.mode === "off") {
    return { artifact, mode: "off", passed: true, findings: [] };
  }
  const findings = findingsFor(content, config.allowTerms);
  return { artifact, mode: config.mode, passed: config.mode === "warn" || findings.length === 0, findings };
}

export function lintCommunicationArtifacts(
  artifacts: readonly { artifact: CommunicationArtifact; content: string }[],
  config: CustomerQualityConfig = DEFAULT_CUSTOMER_QUALITY
): CommunicationQualityReport[] {
  return artifacts.map(({ artifact, content }) => lintCommunicationArtifact(content, artifact, config));
}

export function communicationQualityBlocks(reports: readonly CommunicationQualityReport[]): boolean {
  return reports.some((report) => !report.passed);
}

function artifactLabel(artifact: CommunicationArtifact): string {
  return artifact === "customer-notes" ? "Customer notes" : "Announcement";
}

export function communicationQualityMarkdown(reports: readonly CommunicationQualityReport[]): string[] {
  const lines = ["## Communication quality", ""];
  if (reports.length === 0 || reports.every((report) => report.mode === "off")) {
    lines.push("Quality checks are disabled.", "");
    return lines;
  }
  for (const report of reports) {
    const status = report.findings.length === 0 ? "passed" : report.mode === "error" ? "blocking findings" : "warnings";
    lines.push(`- ${artifactLabel(report.artifact)}: ${status}`);
    for (const finding of report.findings) {
      lines.push(`  - ${finding.rule} on line ${finding.line}: ${finding.message} — \"${finding.excerpt}\"`);
    }
  }
  lines.push("");
  return lines;
}
