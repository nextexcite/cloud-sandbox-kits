import { Sandboxes, pat } from "@docker/sandboxes";

export default {
  async fetch(_request: Request, env: { DOCKER_ID: string; DOCKER_CLOUD_SANDBOX_TOKEN: string }) {
    if (!env.DOCKER_ID || !env.DOCKER_CLOUD_SANDBOX_TOKEN) return new Response("Docker bindings missing", { status: 503 });
    let patFetchAttempted = false;
    let patHttpStatus: number | undefined;
    const sdk = new Sandboxes({ auth: pat({ username: env.DOCKER_ID, personalAccessToken: env.DOCKER_CLOUD_SANDBOX_TOKEN,
      transportRetries: "none",
      fetch: async (input) => {
        patFetchAttempted = true;
        const response = await fetch(input);
        patHttpStatus = response.status;
        return response;
      },
    }) });
    try {
      const result = await sdk.list({}, { timeoutMs: 30_000 });
      return Response.json({ authenticatedSDK: true, count: result.items.length });
    } catch (error) {
      return Response.json({ authenticatedSDK: false, errorName: error instanceof Error ? error.name : "UnknownError",
        code: error && typeof error === "object" && "code" in error ? error.code : undefined, patFetchAttempted, patHttpStatus });
    } finally { await sdk.close(); }
  },
};
