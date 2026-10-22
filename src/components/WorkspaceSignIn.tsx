import { Github } from "lucide-react";
import { DiffEvidenceMark } from "./DiffEvidenceMark";

/** The signed-out workspace entry (first visit or an ended session); the home page links to the same GitHub sign-in. */
export function WorkspaceSignIn({ message, onSignIn, pending = false }: { message: string; onSignIn: () => Promise<void>; pending?: boolean }) {
  return <section className="github-dashboard github-sign-in" aria-labelledby="github-sign-in-title">
    <div className="github-sign-in-mark"><DiffEvidenceMark size={36} /></div>
    <h2 id="github-sign-in-title">Sign in to DiffEvidence</h2>
    <button type="button" className="dashboard-primary-action" disabled={pending} aria-busy={pending} onClick={() => { void onSignIn(); }}><Github size={18} aria-hidden="true" /> {pending ? "Connecting GitHub…" : "Continue with GitHub"}</button>
    {message ? <p className="github-sign-in-status" role="status">{message}</p> : null}
  </section>;
}
