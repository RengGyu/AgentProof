/** The supplied DiffEvidence logo (cropped and resized, never redrawn); decorative beside the product name. */
export function DiffEvidenceMark({ size = 28 }: { size?: number }) {
  // public/brand/diffevidence-mark.png is 253x192; keep its aspect ratio so the symbol is never distorted.
  return <img className="diffevidence-mark" src="/brand/diffevidence-mark.png" alt="" aria-hidden="true" width={Math.round(size * 253 / 192)} height={size} decoding="async" />;
}
