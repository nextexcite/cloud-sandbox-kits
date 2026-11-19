export function maskSandboxIds(listing: string) {
  return listing.replace(/sbx_[a-z0-9]+/g, (id) => "sbx_<masked>".padEnd(id.length));
}
