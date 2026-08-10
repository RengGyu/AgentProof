import { createElement } from "react";
import { CheckCircle2, CircleAlert, HelpCircle, XCircle } from "lucide-react";
import type { DashboardRequirementViewModel } from "@/lib/dashboard-requirement-view-model";

export function RequirementEvidenceList({ requirements }: { requirements: DashboardRequirementViewModel[] }) {
  return createElement("div", { className: "requirement-evidence-list" }, requirements.map((requirement) => createElement("article", { className: "requirement-evidence-card", key: requirement.requirementId },
    createElement("div", { className: "requirement-evidence-card-header" },
      createElement("div", { className: "requirement-evidence-heading" }, createElement("h6", null, requirement.requirementId), createElement("p", null, requirement.objectiveText ?? `Requirement ${requirement.requirementId}`)),
      createElement("details", { className: "requirement-evidence-disclosure", name: "requirement-evidence" },
        createElement("summary", null,
          createElement("span", { className: `requirement-coverage-status ${requirement.status}` }, createElement("span", { className: "requirement-coverage-label" }, "Evidence coverage"), createElement(RequirementStatusIcon, { status: requirement.status }), " ", createElement("span", null, requirement.coverageLabel)),
          createElement("span", { className: "requirement-evidence-disclosure-action" }, "Evidence details")
        ),
        createElement("div", { className: "requirement-evidence-disclosure-content" },
          createElement("p", null, "Coverage is based on deterministic evidence captured for this requirement."),
          createElement("p", null, requirement.coverageMeaning),
          createElement("p", null, `${requirement.evidenceRefs.length} evidence reference${requirement.evidenceRefs.length === 1 ? "" : "s"}`),
          createElement("p", null, `Evidence IDs: ${requirement.evidenceRefs.join(", ") || "Unavailable"}`),
          requirement.deterministicGaps.length > 0
            ? createElement("div", null, createElement("strong", null, "Deterministic gaps"), createElement("ul", null, requirement.deterministicGaps.map((gap, index) => createElement("li", { key: `${requirement.requirementId}:gap:${index}` }, gap))))
            : createElement("p", null, "No deterministic gap recorded."),
          requirement.semanticEvidenceIds.length > 0 ? createElement("p", null, `Supporting evidence IDs: ${requirement.semanticEvidenceIds.join(", ")}`) : null,
          requirement.uncertainties.length > 0 ? createElement("p", null, `Assessment uncertainty: ${requirement.uncertainties.join(", ")}`) : null
        )
      )
    ),
    createElement("p", { className: `requirement-explanation ${requirement.explanation.state}` }, createElement("span", { className: "requirement-explanation-label" }, toExplanationLabel(requirement.explanation.state, requirement.actionIncluded)), requirement.explanation.text),
    requirement.nextAction ? createElement("p", { className: "requirement-next-action" }, createElement("strong", null, "Next:"), " ", requirement.nextAction) : null
  )));
}

function RequirementStatusIcon({ status }: { status: string }) {
  const Icon = status === "met" ? CheckCircle2 : status === "missing" ? XCircle : status === "unclear" ? HelpCircle : CircleAlert;
  return createElement(Icon, { "aria-hidden": true, focusable: "false", size: 16 });
}

function toExplanationLabel(state: DashboardRequirementViewModel["explanation"]["state"], actionIncluded: boolean): string {
  if (state === "assessment" || state === "guidance") return actionIncluded ? "AgentProof reading · Next" : "AgentProof reading";
  if (state === "unavailable") return "Supporting details";
  return "Evidence note";
}
