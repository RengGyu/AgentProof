export interface RequirementProofExpectations {
  implementation: boolean;
  documentation: boolean;
  ci: boolean;
  targetedTest: boolean;
  visual: boolean;
  noImplementationChanges: boolean;
  execution: boolean;
}

/** Classifies explicit objective modalities independently. */
export function requirementProofExpectations(text: string): RequirementProofExpectations {
  const normalized = text.trim();
  const documentation = /\b(?:document|documentation|readme|docs?)\b|(?:문서|설명서)|\b(?:documentar|documentaci[oó]n|gu[ií]a)\b/i.test(normalized);
  const ci = /\b(?:ci|continuous integration|workflow|pipeline)\b|(?:지속적 통합|워크플로|파이프라인)/i.test(normalized);
  const noImplementationChanges = /\b(?:do not|don't|must not)\s+(?:add|chang(?:e|ing)|modify(?:ing)?|touch(?:ing)?)\s+(?:the\s+)?(?:implementation|production|source)\s+code\b|\bwithout\s+(?:(?:chang(?:e|ing)|modify(?:ing)?|touch(?:ing)?)\s+(?:the\s+)?(?:implementation|production|source)\s+code|(?:implementation|production|source)(?:\s+code)?\s+changes?)\b|(?:구현|프로덕션|소스)\s*코드(?:를|는)?\s*(?:변경|수정|건드리)하지\s*(?:않|마)/i.test(normalized);
  const explicitTestArtifact = /\b(?:add|create|write|update|extend|include|provide|require)\b.{0,50}\b(?:tests?|test cases?|coverage|specs?|regression tests?)\b|\b(?:tests?|test cases?|coverage|specs?|regression tests?)\b.{0,50}\b(?:must|should|shall|required|add|create|write|update|cover|verify|confirm)\b|(?:테스트|회귀)(?:를|가|는)?\s*(?:추가|작성|수정|보강|포함|검증)|(?:추가|작성|수정|보강|포함)(?:하|해)?고?.{0,30}(?:테스트|회귀)/i.test(normalized);
  const targetedTest = explicitTestArtifact && !(ci && /^\s*(?:run|execute)\b/i.test(normalized));
  const visual = /\b(?:accessibility|browser-facing|layout|mobile|readability|readable|responsive|screenshot|visual|viewport)\b|\b(?:text|content|card|layout)\s+overlap\b|\boverlap\b.{0,30}\b(?:text|content|card|layout)\b|\b\d{3,4}px\b|(?:접근성|가독성|반응형|모바일|레이아웃|스크린샷|시각적|뷰포트|텍스트\s*겹침)/i.test(normalized);
  const genericAddBehaviorAndTests = /^add\s+(?!(?:an?\s+)?(?:tests?|coverage|specs?|regression)\b).{1,120}\b(?:and|with)\s+(?:tests?|coverage|specs?|regression)\b/i.test(normalized) && !documentation && !ci;
  const koreanBehaviorAndTests = /(?:기능|동작|처리|지원).{0,60}(?:추가|변경|구현).{0,80}(?:테스트|회귀)|(?:테스트|회귀).{0,80}(?:기능|동작|처리|지원).{0,60}(?:추가|변경|구현)/.test(normalized) && !documentation && !ci;
  const explicitBehavior = genericAddBehaviorAndTests || koreanBehaviorAndTests || /^(?:(?:must|should|shall|required to)\s+)?(?:allow|show|ensure|display|keep|retry|implement|support|prevent|handle|validate|return|render|enable|disable|remove|fix|add\s+support|change|refactor|reject|normalize|format)\b|\b(?:and|to)\s+(?:allow|show|ensure|display|keep|retry|implement|support|prevent|handle|validate|return|render|enable|disable|remove|fix)\b|(?:허용|표시|보장|구현|지원|방지|처리|검증|반환|렌더링|활성화|비활성화|제거)/i.test(normalized);
  const implementation = !noImplementationChanges && (explicitBehavior || visual || (!documentation && !ci && !targetedTest));

  return {
    implementation,
    documentation,
    ci,
    targetedTest,
    visual,
    noImplementationChanges,
    execution: implementation || ci || targetedTest
  };
}
