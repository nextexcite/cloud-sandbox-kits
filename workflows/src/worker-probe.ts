import { Sandboxes, pat } from "@docker/sandboxes";

export default {
  async fetch() {
    const sdk = new Sandboxes({ auth: pat({ username: "unused", personalAccessToken: "unused" }) });
    await sdk.close();
    let requestOptions: string;
    try {
      new Request("https://example.com", { method: "POST", body: "{}", redirect: "error", credentials: "omit", cache: "no-store", signal: new AbortController().signal });
      requestOptions = "supported";
    } catch (error) { requestOptions = error instanceof Error ? error.message : "unsupported"; }
    new Request("https://example.com", { method: "POST", body: "{}", redirect: "manual", credentials: "omit", cache: "no-store", signal: new AbortController().signal });
    return Response.json({ import: "SDK_IMPORT_PASS", sdkAuthRequestOptions: requestOptions, manualRedirectControl: "supported" });
  },
};
