import type { GrammarReport } from "@mvl/shared";

function clock(value: number | null): string {
  if (value === null) return "—";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = (value % 60).toFixed(3).padStart(6, "0");
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${seconds}`;
}

export function formatGrammarReportMarkdown(report: GrammarReport): string {
  const lines = [
    `# ${report.source.title ?? "Multilingual grammar report"}`,
    "",
    `- Explanation language: ${report.explanationLanguage}`,
    `- Sentences: ${report.summary.sentenceCount}`,
    `- Grammar points: ${report.summary.grammarPointCount}`,
    `- Model: ${report.analysis.model}`,
    "",
  ];
  for (const sentence of report.sentences) {
    lines.push(
      `## ${sentence.id} · ${clock(sentence.start)}–${clock(sentence.end)}`,
      "",
      sentence.text,
      "",
    );
    if (sentence.reading !== null) {
      lines.push(`Reading: ${sentence.reading}`, "");
    }
    if (sentence.translation !== null) {
      lines.push(`Translation: ${sentence.translation}`, "");
    }
    if (sentence.needsReview) {
      lines.push("> Reconstruction needs review.", "");
    }
    if (sentence.grammar.length === 0) {
      lines.push("No grammar points identified.", "");
      continue;
    }
    for (const grammar of sentence.grammar) {
      lines.push(
        `### ${grammar.surface} · ${grammar.levelSystem} ${grammar.level}`,
        "",
        `- Pattern: ${grammar.pattern}`,
        `- Formation: ${grammar.formation}`,
        `- Meaning: ${grammar.meaning}`,
        `- Category: ${grammar.category}`,
        `- Confidence: ${grammar.confidence.toFixed(2)}`,
        "",
        grammar.explanation,
        "",
      );
      for (const example of grammar.examples) {
        lines.push("Example:", "", example.text, "");
        if (example.reading !== null) {
          lines.push(`Example reading: ${example.reading}`, "");
        }
        if (example.translation !== null) {
          lines.push(`Example translation: ${example.translation}`, "");
        }
      }
    }
  }
  return `${lines.join("\n")}\n`;
}
