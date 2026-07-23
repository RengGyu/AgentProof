export declare const STRONG_EXECUTION_EVIDENCE_PATTERN: RegExp;
export declare const WEAK_EXECUTION_EVIDENCE_PATTERN: RegExp;
export declare function isExecutionSignalText(text: string): boolean;
export declare function isExecutionEvidenceSignal(label: string, text?: string, locator?: string): boolean;
export declare function isFailedAmbiguousActionsExecutionSignal(label: string, status: string | undefined, locator?: string, text?: string): boolean;
export declare function isExecutionEvidenceItemSignal(label: string, status: string | undefined, locator?: string, text?: string): boolean;
export declare function hasPassingEvidenceStatusPrefix(summary: string): boolean;
