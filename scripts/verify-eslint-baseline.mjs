import { readFileSync } from "node:fs";
import { relative } from "node:path";

const report = JSON.parse(readFileSync("eslint-report.json", "utf8"));

// Existing formatting debt on main when CI was introduced with BP-1.
// Keep this list narrow: any new ESLint error anywhere (including these files)
// still fails CI unless it matches one of these exact baseline findings.
const allowedBaseline = new Set([
  "src/lib/supabase.ts|prettier/prettier|181|3",
  "src/routes/boka/$slug.tsx|prettier/prettier|418|47",
  "src/routes/boka/$slug.tsx|prettier/prettier|1558|57",
]);

const errors = report.flatMap((file) =>
  file.messages
    .filter((message) => message.severity === 2)
    .map((message) => ({
      path: relative(process.cwd(), file.filePath).replaceAll("\\", "/"),
      ruleId: message.ruleId ?? "unknown",
      line: message.line,
      column: message.column,
      message: message.message,
    })),
);

const unexpected = errors.filter(
  (error) =>
    !allowedBaseline.has(`${error.path}|${error.ruleId}|${error.line}|${error.column}`),
);

if (unexpected.length > 0) {
  console.error("Unexpected ESLint errors:");
  for (const error of unexpected) {
    console.error(
      `- ${error.path}:${error.line}:${error.column} ${error.ruleId} ${error.message}`,
    );
  }
  process.exit(1);
}

if (errors.length > 0) {
  console.log(`ESLint: ${errors.length} known baseline formatting errors; no new errors.`);
} else {
  console.log("ESLint: clean baseline.");
}
