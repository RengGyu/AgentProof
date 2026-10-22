/** A source range in focus; decorative beside the AgentProof name, never a verification badge. */
export function AgentProofMark({ size = 24 }: { size?: number }) {
  return <svg className="agentproof-mark" xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M9 4H4v16h5m6 0h5V4h-5M9 12h6" />
  </svg>;
}
