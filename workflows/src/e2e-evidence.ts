export function maskSandboxIds(listing: string) {
  return listing.replace(/sbx_[a-z0-9]+/g, (id) => "sbx_<masked>".padEnd(id.length));
}

export async function withFallbackSweep<T>(diagnostics: () => Promise<T>, sweep: () => Promise<void>): Promise<T> {
  try { return await diagnostics(); }
  finally { await sweep(); }
}
