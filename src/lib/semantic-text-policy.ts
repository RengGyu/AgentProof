const SENSITIVE_EVIDENCE_PATTERN =
  /(?:(?:raw|full|complete)\s+(?:(?:CI|test|job|check)\s+)?(?:source(?:\s+file)?|file\s+contents?|repository\s+contents?|diff|patch|logs?|output|artifacts?)|(?:CI|test|job|check)(?:[-\s](?:run|step))?\s+(?:logs?|output|artifacts?|metadata)|artifact[-\s]level\s+evidence|job[-\s](?:run|step)\s+(?:logs?|metadata))/i;

const EVIDENCE_REQUEST_PATTERN =
  /\b(?:attach|collect|download|fetch|include|inspect|link|obtain|paste|provide|request|retrieve|review|send|share|show|supply|upload)\b/i;

const KOREAN_SENSITIVE_EVIDENCE_PATTERN =
  /(?:원문|전체\s*(?:소스|파일|로그|출력)|파일\s*내용|코드\s*전체|CI\s*로그|테스트\s*출력|아티팩트)/i;

const KOREAN_REQUEST_PATTERN =
  /(?:가져오|검토|공유|다운로드|보여|붙여|수집|연결|요구|요청|전송|제공|첨부|필요|업로드)/i;

const SAFE_NON_RETENTION_PATTERN =
  /\b(?:not|never)\s+(?:available|collected|fetched|included|provided|retained|stored)\b|\b(?:unavailable|omitted)\b|\bno\s+.+\b(?:is|are|was|were)\s+(?:available|collected|fetched|included|provided|retained|stored)\b/i;

const KOREAN_SAFE_NON_RETENTION_PATTERN =
  /(?:저장|보관|수집|가져오|제공|포함)(?:되지\s*않|하지\s*않|되지\s*못)|(?:사용할\s*수\s*없|누락)/i;

export function isProhibitedEvidenceRequestText(value: string): boolean {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return false;
  return normalized.split(/(?:[;.!?]\s+|\n+)/).some((segment) => {
    if (SENSITIVE_EVIDENCE_PATTERN.test(segment)) {
      return !SAFE_NON_RETENTION_PATTERN.test(segment) || EVIDENCE_REQUEST_PATTERN.test(segment);
    }
    if (KOREAN_SENSITIVE_EVIDENCE_PATTERN.test(segment)) {
      return !KOREAN_SAFE_NON_RETENTION_PATTERN.test(segment) || KOREAN_REQUEST_PATTERN.test(segment);
    }
    return false;
  });
}
