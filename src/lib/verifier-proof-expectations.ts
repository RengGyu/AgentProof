export interface RequirementProofExpectations {
  implementation: boolean;
  documentation: boolean;
  ci: boolean;
  targetedTest: boolean;
  execution: boolean;
}

/** Classifies explicit objective modalities independently. */
export function requirementProofExpectations(text: string): RequirementProofExpectations {
  const normalized = text.trim();
  const documentation = /\b(?:document|documentation|readme|docs?)\b|(?:문서|설명서)/i.test(normalized);
  const ci = /\b(?:ci|continuous integration|workflow|pipeline)\b|(?:지속적 통합|워크플로|파이프라인)/i.test(normalized);
  const targetedTest = /\b(?:tests?|coverage|specs?|regression)\b|(?:테스트|회귀)/i.test(normalized);
  const genericAddBehaviorAndTests = /^add\s+(?!(?:an?\s+)?(?:tests?|coverage|specs?|regression)\b).{1,120}\b(?:and|with)\s+(?:tests?|coverage|specs?|regression)\b/i.test(normalized) && !documentation && !ci;
  const koreanBehaviorAndTests = /(?:기능|동작|처리|지원).{0,60}(?:추가|변경|구현).{0,80}(?:테스트|회귀)|(?:테스트|회귀).{0,80}(?:기능|동작|처리|지원).{0,60}(?:추가|변경|구현)/.test(normalized) && !documentation && !ci;
  const explicitBehavior = genericAddBehaviorAndTests || koreanBehaviorAndTests || /^(?:(?:must|should|shall|required to)\s+)?(?:allow|show|ensure|display|retry|implement|support|prevent|handle|validate|return|render|enable|disable|remove|fix|add\s+support|change|refactor)\b|\b(?:and|to)\s+(?:allow|show|ensure|display|retry|implement|support|prevent|handle|validate|return|render|enable|disable|remove|fix)\b|(?:허용|표시|보장|구현|지원|방지|처리|검증|반환|렌더링|활성화|비활성화|제거)/i.test(normalized);
  const implementation = explicitBehavior || (!documentation && !ci && !targetedTest);

  return {
    implementation,
    documentation,
    ci,
    targetedTest,
    execution: implementation || ci || targetedTest
  };
}
