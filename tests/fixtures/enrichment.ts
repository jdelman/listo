export function enrichment(overrides: Record<string, unknown> = {}) {
  return {
    category: "note", description: "A useful note about durable background processing.",
    specs: { name: null, size: null, measurements: [], price: null, currency: null, brand: null, material: null, color: null, year: null, tmdbId: null, platform: null, platformId: null, attributes: [] },
    ...overrides,
  };
}
export function completion(value = enrichment()) {
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] }));
}
