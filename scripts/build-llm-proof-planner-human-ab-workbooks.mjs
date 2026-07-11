import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

// Offline workbook authoring only: this builder does not read API keys or call network services.
export const ARTIFACT_TOOL_VERSION = "2.8.6";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputRoot = process.env.AGENTPROOF_HUMAN_AB_OUTPUT_ROOT
  ? path.resolve(process.env.AGENTPROOF_HUMAN_AB_OUTPUT_ROOT)
  : path.join(root, "outputs", "controlled-human-ab-v1");
const raterPath = path.join(outputRoot, "rater", "AgentProof-Human-AB-Rater-Workbook-Template-v1.xlsx");
const coordinatorPath = path.join(outputRoot, "coordinator", "AgentProof-Human-AB-Coordinator-Summary-v1.xlsx");
const previewDir = path.join(outputRoot, "previews");

const colors = {
  navy: "#17324D",
  teal: "#0F766E",
  paleTeal: "#E6F4F1",
  paleBlue: "#EAF1F8",
  paleYellow: "#FFF7D6",
  paleRed: "#FDECEC",
  gray: "#64748B",
  border: "#D7E0E8"
};

const headers = [
  "ProtocolVersion",
  "ExperimentId",
  "SealedHoldoutReceiptSha256",
  "RaterPseudonym",
  "OpaqueCaseId",
  "BlindedArmId",
  "AssignmentIndex",
  "RequirementAccuracy",
  "RequirementEvidenceNote",
  "ProofPlanUsefulness",
  "ProofPlanEvidenceNote",
  "WarningAccuracy",
  "WarningEvidenceNote",
  "ReviewDecisionTimeSeconds",
  "NotScorableReason",
  "StartedAt",
  "SubmittedAt",
  "TimingIntegrity"
];

await fs.mkdir(path.dirname(raterPath), { recursive: true });
await fs.mkdir(path.dirname(coordinatorPath), { recursive: true });
await fs.mkdir(previewDir, { recursive: true });

const raterWorkbook = buildRaterWorkbook();
const coordinatorWorkbook = buildCoordinatorWorkbook();

await verifyRaterWorkbook(raterWorkbook);
await verifyCoordinatorWorkbookWithSamples(coordinatorWorkbook);

await render(raterWorkbook, "Instructions", "rater-instructions", "A1:F24");
await render(raterWorkbook, "Labels", "rater-labels", "A1:R18");
await render(coordinatorWorkbook, "Instructions", "coordinator-instructions", "A1:F22");
await render(coordinatorWorkbook, "Assignment Preflight", "coordinator-preflight", "A1:I18");
await render(coordinatorWorkbook, "Imported Labels", "coordinator-imported", "A1:S18");
await render(coordinatorWorkbook, "Summary", "coordinator-summary", "A1:G14");

await scanFormulaErrors(raterWorkbook, "rater workbook");
await scanFormulaErrors(coordinatorWorkbook, "coordinator workbook");

const raterOutput = await SpreadsheetFile.exportXlsx(raterWorkbook);
await raterOutput.save(raterPath);
const coordinatorOutput = await SpreadsheetFile.exportXlsx(coordinatorWorkbook);
await coordinatorOutput.save(coordinatorPath);

console.log(JSON.stringify({ artifactToolVersion: ARTIFACT_TOOL_VERSION, outputRoot, raterPath, coordinatorPath }));

function buildRaterWorkbook() {
  const workbook = Workbook.create();
  const instructions = workbook.worksheets.add("Instructions");
  const labels = workbook.worksheets.add("Labels");
  for (const sheet of [instructions, labels]) sheet.showGridLines = false;

  title(instructions, "A1:F2", "AgentProof Controlled Human A/B — Individual Rater Workbook");
  instructions.getRange("A4:B10").values = [
    ["Workbook boundary", "This file is for exactly one rater and contains no coordinator Summary or other reviewers' results."],
    ["Assignments", "Use only the opaque cases and opaque arm IDs prefilled for you after coordinator preflight."],
    ["Same-case rule", "You must not receive the other arm or a duplicate assignment for the same case."],
    ["Timing", "Use the runner. It starts a monotonic timer at report reveal and writes elapsed seconds plus audit timestamps."],
    ["Scoring", "Rate requirement accuracy, proofPlan usefulness, and warning accuracy from 1 to 5."],
    ["Not scorable", "Use only insufficient_source_evidence or operational_failure; these rows are excluded from Summary."],
    ["Privacy", "Do not paste raw diffs, full logs, prompts/reasoning, secrets, private data, or case identities."]
  ];
  instructions.getRange("A4:A10").format = { fill: colors.paleBlue, font: { bold: true, color: colors.navy }, wrapText: true };
  instructions.getRange("B4:B10").format = { wrapText: true, verticalAlignment: "top" };
  instructions.mergeCells("A12:F12");
  instructions.getRange("A12").values = [["Exactly four separate evaluation items — no overall or preference score"]];
  instructions.getRange("A12:F12").format = { fill: colors.teal, font: { bold: true, color: "#FFFFFF" } };
  instructions.getRange("A14:C18").values = [
    ["Item", "Allowed value", "Anchor"],
    ["Requirement accuracy", "1–5", "1 material distortion/omission/invention; 3 broadly accurate with material excess/omission; 5 faithful material requirements with no invention"],
    ["proofPlan usefulness", "1–5", "1 absent/irrelevant/infeasible; 3 partly actionable but generic; 5 minimal concrete proof tied to the same requirement and gap"],
    ["Warning accuracy", "1–5", "1 material false alarm/reassurance/contradiction/omission; 3 mixed; 5 grounded and calibrated"],
    ["Review decision time", "Runner seconds", "Monotonic elapsed time from report reveal until the evidence-sufficiency decision"]
  ];
  instructions.getRange("A14:C14").format = { fill: colors.navy, font: { bold: true, color: "#FFFFFF" } };
  instructions.getRange("A15:C18").format = { wrapText: true, verticalAlignment: "top" };
  instructions.getRange("A20:F23").values = [
    ["Runner sequence", null, null, null, null, null],
    ["1", "Read the bounded source packet before report reveal.", null, null, null, null],
    ["2", "Reveal one blinded report; runner starts and stops timing automatically.", null, null, null, null],
    ["3", "Score only the three ordinal items; the runner writes the completed row.", null, null, null, null]
  ];
  instructions.mergeCells("A20:F20");
  instructions.getRange("A20:F20").format = { fill: colors.paleTeal, font: { bold: true, color: colors.teal } };
  for (let row = 21; row <= 23; row += 1) instructions.mergeCells(`B${row}:F${row}`);
  instructions.getRange("A21:A23").format = { font: { bold: true, color: colors.teal }, horizontalAlignment: "center" };
  instructions.getRange("B21:F23").format = { wrapText: true };
  instructions.getRange("A4:F23").format.borders = { preset: "inside", style: "thin", color: colors.border };
  instructions.getRange("A:A").format.columnWidth = 24;
  instructions.getRange("B:B").format.columnWidth = 66;
  instructions.getRange("C:C").format.columnWidth = 92;
  instructions.getRange("D:F").format.columnWidth = 10;
  instructions.getRange("A1:F23").format.autofitRows();
  instructions.freezePanes.freezeRows(2);

  labels.getRange("A1:R1").values = [headers];
  header(labels.getRange("A1:R1"));
  labels.getRange("A2:R101").values = Array.from({ length: 100 }, () => Array(18).fill(null));
  labels.getRange("A2:R101").format.borders = { insideHorizontal: { style: "thin", color: colors.border } };
  labels.getRange("H2:H101").format.fill = colors.paleYellow;
  labels.getRange("J2:J101").format.fill = colors.paleYellow;
  labels.getRange("L2:L101").format.fill = colors.paleYellow;
  labels.getRange("O2:O101").format.fill = colors.paleYellow;
  labels.getRange("N2:N101").format.fill = colors.paleBlue;
  labels.getRange("P2:Q101").format.fill = colors.paleBlue;
  labels.getRange("R2:R101").format.fill = colors.paleBlue;
  for (const scoreRange of ["H2:H101", "J2:J101", "L2:L101"]) {
    labels.getRange(scoreRange).dataValidation = { rule: { type: "whole", operator: "between", formula1: 1, formula2: 5 } };
    labels.getRange(scoreRange).format.numberFormat = "0";
    labels.getRange(scoreRange).format.horizontalAlignment = "center";
  }
  labels.getRange("F2:F101").dataValidation = { rule: { type: "list", values: ["A", "B"] } };
  labels.getRange("N2:N101").dataValidation = { rule: { type: "decimal", operator: "greaterThanOrEqual", formula1: 0 } };
  labels.getRange("N2:N101").format.numberFormat = "0.000";
  labels.getRange("O2:O101").dataValidation = { rule: { type: "list", values: ["insufficient_source_evidence", "operational_failure"] } };
  labels.getRange("P2:Q101").format.numberFormat = "yyyy-mm-dd hh:mm:ss";
  labels.getRange("R2:R101").dataValidation = { rule: { type: "list", values: ["runner_monotonic_complete", "runner_monotonic_not_scorable"] } };
  labels.getRange("I2:I101").format.wrapText = true;
  labels.getRange("K2:K101").format.wrapText = true;
  labels.getRange("M2:M101").format.wrapText = true;
  setLabelWidths(labels);
  labels.freezePanes.freezeRows(1);
  labels.freezePanes.freezeColumns(5);
  const labelsTable = labels.tables.add("A1:R101", true, "RaterLabelsTable");
  labelsTable.style = "TableStyleMedium2";
  return workbook;
}

function buildCoordinatorWorkbook() {
  const workbook = Workbook.create();
  const instructions = workbook.worksheets.add("Instructions");
  const preflight = workbook.worksheets.add("Assignment Preflight");
  const imported = workbook.worksheets.add("Imported Labels");
  const summary = workbook.worksheets.add("Summary");
  for (const sheet of [instructions, preflight, imported, summary]) sheet.showGridLines = false;

  title(instructions, "A1:F2", "AgentProof Controlled Human A/B — Coordinator Workbook");
  instructions.getRange("A4:B11").values = [
    ["Distribution", "Coordinator-only. Never send this workbook to raters."],
    ["Assignment gate", "Global preflight must pass before one isolated workbook is prepared per rater."],
    ["Same-case rule", "A reviewer/case canonical key may appear exactly once; duplicate same-arm and A/B exposure both fail."],
    ["Import gate", "Import scalar label values only. Reject formulas, external links, DDE, macros, and unexpected sheets."],
    ["Eligible Summary", "Only ScorableComplete rows enter counts, medians, and p75."],
    ["Excluded", "Pending, Partial, and NotScorable rows are excluded from every Summary metric."],
    ["Arm key", "Do not add or reveal deterministic/LLM arm mapping until labels are frozen."],
    ["Manifest", "Resolved snapshot, source, protocol, assignment, and workbook hashes remain outside rater files."]
  ];
  instructions.getRange("A4:A11").format = { fill: colors.paleBlue, font: { bold: true, color: colors.navy }, wrapText: true };
  instructions.getRange("B4:B11").format = { wrapText: true, verticalAlignment: "top" };
  instructions.mergeCells("A13:F13");
  instructions.getRange("A13").values = [["Pre-freeze blockers must remain visible"]];
  instructions.getRange("A13:F13").format = { fill: colors.teal, font: { bold: true, color: "#FFFFFF" } };
  instructions.getRange("A15:B20").values = [
    ["Source tree clean", "Required"],
    ["Single resolved model snapshot", "Required after smoke/run"],
    ["Assignment preflight passed", "Required"],
    ["Per-rater workbook hashes", "Required after actual assignment export"],
    ["Coordinator workbook hash", "Prepared by this task"],
    ["Sealed holdout receipt", "Required before controlled A/B"]
  ];
  instructions.getRange("A15:A20").format = { fill: colors.paleRed, font: { bold: true, color: "#9F1239" } };
  instructions.getRange("A4:F20").format.borders = { preset: "inside", style: "thin", color: colors.border };
  instructions.getRange("A:A").format.columnWidth = 30;
  instructions.getRange("B:B").format.columnWidth = 72;
  instructions.getRange("C:F").format.columnWidth = 10;
  instructions.getRange("A1:F20").format.autofitRows();
  instructions.freezePanes.freezeRows(2);

  const preflightHeaders = ["AssignmentId", "RaterPseudonym", "OpaqueCaseId", "BlindedArmId", "AssignmentIndex", "PacketSha256", "PreflightStatus", "PreflightReason", "WorkbookSha256"];
  preflight.getRange("A1:I1").values = [preflightHeaders];
  header(preflight.getRange("A1:I1"));
  preflight.getRange("A2:I201").values = Array.from({ length: 200 }, () => Array(9).fill(null));
  preflight.getRange("A2:I201").format.borders = { insideHorizontal: { style: "thin", color: colors.border } };
  preflight.getRange("D2:D201").dataValidation = { rule: { type: "list", values: ["A", "B"] } };
  preflight.getRange("G2:G201").dataValidation = { rule: { type: "list", values: ["passed", "blocked"] } };
  preflight.getRange("A:A").format.columnWidth = 24;
  preflight.getRange("B:E").format.columnWidth = 20;
  preflight.getRange("F:F").format.columnWidth = 38;
  preflight.getRange("G:G").format.columnWidth = 18;
  preflight.getRange("H:H").format.columnWidth = 42;
  preflight.getRange("I:I").format.columnWidth = 38;
  preflight.freezePanes.freezeRows(1);
  preflight.tables.add("A1:I201", true, "AssignmentPreflightTable").style = "TableStyleMedium2";

  imported.getRange("A1:S1").values = [[...headers, "SubmissionState"]];
  header(imported.getRange("A1:S1"));
  imported.getRange("A2:R501").values = Array.from({ length: 500 }, () => Array(18).fill(null));
  imported.getRange("S2").formulas = [[submissionStateFormula(2)]];
  imported.getRange("S2:S501").fillDown();
  imported.getRange("A2:S501").format.borders = { insideHorizontal: { style: "thin", color: colors.border } };
  imported.getRange("S2:S501").format.fill = colors.paleBlue;
  imported.getRange("H2:H501").dataValidation = { rule: { type: "whole", operator: "between", formula1: 1, formula2: 5 } };
  imported.getRange("J2:J501").dataValidation = { rule: { type: "whole", operator: "between", formula1: 1, formula2: 5 } };
  imported.getRange("L2:L501").dataValidation = { rule: { type: "whole", operator: "between", formula1: 1, formula2: 5 } };
  imported.getRange("F2:F501").dataValidation = { rule: { type: "list", values: ["A", "B"] } };
  imported.getRange("O2:O501").dataValidation = { rule: { type: "list", values: ["insufficient_source_evidence", "operational_failure"] } };
  imported.getRange("N2:N501").format.numberFormat = "0.000";
  imported.getRange("P2:Q501").format.numberFormat = "yyyy-mm-dd hh:mm:ss";
  imported.getRange("R2:R501").dataValidation = { rule: { type: "list", values: ["runner_monotonic_complete", "runner_monotonic_not_scorable"] } };
  setLabelWidths(imported);
  imported.getRange("R:R").format.columnWidth = 30;
  imported.getRange("S:S").format.columnWidth = 22;
  imported.freezePanes.freezeRows(1);
  imported.freezePanes.freezeColumns(5);
  imported.tables.add("A1:S501", true, "ImportedLabelsTable").style = "TableStyleMedium2";

  title(summary, "A1:G2", "Coordinator Summary — ScorableComplete rows only");
  summary.getRange("A4:G6").values = [
    ["BlindedArmId", "CompletedRows", "RequirementMedian", "ProofPlanMedian", "WarningMedian", "DecisionTimeMedianSec", "DecisionTimeP75Sec"],
    ["A", null, null, null, null, null, null],
    ["B", null, null, null, null, null, null]
  ];
  header(summary.getRange("A4:G4"), colors.teal);
  for (let row = 5; row <= 6; row += 1) {
    summary.getRange(`B${row}`).formulas = [[`=COUNTIFS('Imported Labels'!$F$2:$F$501,$A${row},'Imported Labels'!$S$2:$S$501,"ScorableComplete")`]];
    summary.getRange(`C${row}`).formulas = [[`=IFERROR(MEDIAN(FILTER('Imported Labels'!$H$2:$H$501,('Imported Labels'!$F$2:$F$501=$A${row})*('Imported Labels'!$S$2:$S$501="ScorableComplete"))),"")`]];
    summary.getRange(`D${row}`).formulas = [[`=IFERROR(MEDIAN(FILTER('Imported Labels'!$J$2:$J$501,('Imported Labels'!$F$2:$F$501=$A${row})*('Imported Labels'!$S$2:$S$501="ScorableComplete"))),"")`]];
    summary.getRange(`E${row}`).formulas = [[`=IFERROR(MEDIAN(FILTER('Imported Labels'!$L$2:$L$501,('Imported Labels'!$F$2:$F$501=$A${row})*('Imported Labels'!$S$2:$S$501="ScorableComplete"))),"")`]];
    summary.getRange(`F${row}`).formulas = [[`=IFERROR(MEDIAN(FILTER('Imported Labels'!$N$2:$N$501,('Imported Labels'!$F$2:$F$501=$A${row})*('Imported Labels'!$S$2:$S$501="ScorableComplete"))),"")`]];
    summary.getRange(`G${row}`).formulas = [[`=IFERROR(PERCENTILE.INC(FILTER('Imported Labels'!$N$2:$N$501,('Imported Labels'!$F$2:$F$501=$A${row})*('Imported Labels'!$S$2:$S$501="ScorableComplete")),0.75),"")`]];
  }
  summary.getRange("A5:G6").format = { fill: colors.paleTeal, borders: { preset: "inside", style: "thin", color: colors.border } };
  summary.getRange("B5:B6").format.numberFormat = "0";
  summary.getRange("C5:G6").format.numberFormat = "0.0";
  summary.mergeCells("A9:G9");
  summary.getRange("A9").values = [["Eligibility rule"]];
  summary.getRange("A9:G9").format = { fill: colors.paleBlue, font: { bold: true, color: colors.navy } };
  summary.mergeCells("A10:G13");
  summary.getRange("A10").values = [["Every aggregate requires SubmissionState = ScorableComplete. NotScorable, Partial, Pending, formula-bearing imports, and invalid scalar rows must be excluded before labels are frozen. Keep all four metrics separate and do not reveal the arm key here before freeze."]];
  summary.getRange("A10:G13").format = { wrapText: true, verticalAlignment: "top", font: { color: colors.gray } };
  summary.getRange("A:G").format.columnWidth = 24;
  summary.getRange("A1:G13").format.autofitRows();
  summary.freezePanes.freezeRows(2);
  return workbook;
}

function submissionStateFormula(row) {
  return `=IF(COUNTA($H${row}:$R${row})=0,"Pending",IF(AND($A${row}<>"",$B${row}<>"",$C${row}<>"",$D${row}<>"",$E${row}<>"",$F${row}<>"",ISNUMBER($G${row}),$G${row}>=1,ISNUMBER($H${row}),MOD($H${row},1)=0,$H${row}>=1,$H${row}<=5,ISNUMBER($J${row}),MOD($J${row},1)=0,$J${row}>=1,$J${row}<=5,ISNUMBER($L${row}),MOD($L${row},1)=0,$L${row}>=1,$L${row}<=5,ISNUMBER($N${row}),$N${row}>=0,$O${row}="",$P${row}<>"",$Q${row}<>"",$R${row}="runner_monotonic_complete"),"ScorableComplete",IF(AND($A${row}<>"",$B${row}<>"",$C${row}<>"",$D${row}<>"",$E${row}<>"",$F${row}<>"",ISNUMBER($G${row}),$G${row}>=1,OR($O${row}="insufficient_source_evidence",$O${row}="operational_failure"),$H${row}="",$J${row}="",$L${row}="",$N${row}="",$Q${row}<>"",$R${row}="runner_monotonic_not_scorable"),"NotScorable","Partial")))`;
}

async function verifyRaterWorkbook(workbook) {
  const sheets = await workbook.inspect({ kind: "sheet", include: "name", maxChars: 2000 });
  const formulas = await workbook.inspect({ kind: "formula", sheetId: "Labels", range: "A1:R101", options: { maxResults: 20 }, maxChars: 2000 });
  console.log(sheets.ndjson);
  console.log(formulas.ndjson);
  if (formulas.ndjson.includes("formula")) throw new Error("Rater Labels must contain zero formulas.");
}

async function verifyCoordinatorWorkbookWithSamples(workbook) {
  const imported = workbook.worksheets.getItem("Imported Labels");
  imported.getRange("A2:R5").values = [
    sampleRow("rater-1", "case-1", "A", 1, 5, 4, 3, 10, ""),
    sampleRow("rater-2", "case-2", "A", 1, null, null, null, null, "operational_failure"),
    sampleRow("rater-3", "case-3", "A", 1, 2, null, null, null, ""),
    sampleRow("rater-4", "case-4", "B", 1, 3, 2, 4, 20, "")
  ];
  const qa = await workbook.inspect({ kind: "table", range: "Imported Labels!A1:S6", include: "values,formulas", tableMaxRows: 6, tableMaxCols: 19, maxChars: 10000 });
  const summaryQa = await workbook.inspect({ kind: "table", range: "Summary!A4:G6", include: "values,formulas", tableMaxRows: 3, tableMaxCols: 7, maxChars: 6000 });
  console.log(qa.ndjson);
  console.log(summaryQa.ndjson);
  if (!qa.ndjson.includes("ScorableComplete") || !qa.ndjson.includes("NotScorable") || !qa.ndjson.includes("Partial")) {
    throw new Error("Coordinator completion-state formula QA failed.");
  }
  if (!summaryQa.ndjson.includes('"A",1,5,4,3,10,10') || !summaryQa.ndjson.includes('"B",1,3,2,4,20,20')) {
    throw new Error("Coordinator Summary QA included an excluded row or missed a completed row.");
  }
  imported.getRange("A2:R5").clear({ applyTo: "contents" });
  const cleared = await workbook.inspect({ kind: "table", range: "Summary!A4:G6", include: "values,formulas", tableMaxRows: 3, tableMaxCols: 7, maxChars: 6000 });
  console.log(cleared.ndjson);
}

function sampleRow(reviewer, caseId, arm, index, requirement, proofPlan, warning, seconds, reason) {
  return [
    "agentproof-human-ab.v1",
    "exp-qa",
    "a".repeat(64),
    reviewer,
    caseId,
    arm,
    index,
    requirement,
    "",
    proofPlan,
    "",
    warning,
    "",
    seconds,
    reason,
    "2026-07-10 00:00:00",
    "2026-07-10 00:00:20",
    reason ? "runner_monotonic_not_scorable" : "runner_monotonic_complete"
  ];
}

function title(sheet, range, text) {
  sheet.mergeCells(range);
  sheet.getRange(range.split(":")[0]).values = [[text]];
  sheet.getRange(range).format = {
    fill: colors.navy,
    font: { bold: true, color: "#FFFFFF", size: 17 },
    verticalAlignment: "center",
    horizontalAlignment: "left"
  };
}

function header(range, fill = colors.navy) {
  range.format = {
    fill,
    font: { bold: true, color: "#FFFFFF" },
    wrapText: true,
    verticalAlignment: "center",
    horizontalAlignment: "center",
    rowHeight: 42,
    borders: { preset: "inside", style: "thin", color: "#32506B" }
  };
}

function setLabelWidths(sheet) {
  sheet.getRange("A:A").format.columnWidth = 24;
  sheet.getRange("B:B").format.columnWidth = 20;
  sheet.getRange("C:C").format.columnWidth = 38;
  sheet.getRange("D:F").format.columnWidth = 18;
  sheet.getRange("G:H").format.columnWidth = 18;
  sheet.getRange("I:I").format.columnWidth = 42;
  sheet.getRange("J:J").format.columnWidth = 20;
  sheet.getRange("K:K").format.columnWidth = 42;
  sheet.getRange("L:L").format.columnWidth = 18;
  sheet.getRange("M:M").format.columnWidth = 42;
  sheet.getRange("N:O").format.columnWidth = 25;
  sheet.getRange("P:Q").format.columnWidth = 22;
  sheet.getRange("R:R").format.columnWidth = 30;
}

async function render(workbook, sheetName, fileName, range) {
  const preview = await workbook.render({ sheetName, range, scale: 1, format: "png" });
  await fs.writeFile(`${previewDir}/${fileName}.png`, new Uint8Array(await preview.arrayBuffer()));
}

async function scanFormulaErrors(workbook, label) {
  const errors = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 100 },
    summary: `${label} formula error scan`
  });
  console.log(errors.ndjson);
  if (!errors.ndjson.includes("matched 0")) throw new Error(`${label} contains formula errors.`);
}
