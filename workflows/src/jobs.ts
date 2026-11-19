export const sizes = ["micro", "small", "medium", "large", "xl"] as const;
export function validateJob(kind: string, body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("JSON object required");
  const input = body as Record<string, unknown>;
  const url = (key: string, optional = false) => {
    if (optional && input[key] === undefined) return undefined;
    if (typeof input[key] !== "string") throw new Error(`${key} must be a URL`);
    const parsed = new URL(input[key]);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(`${key} must be HTTP(S) without credentials`);
    return parsed.href;
  };
  if (kind === "browser") return { url: url("url") };
  if (kind === "encode") {
    const durationSec = input.durationSec ?? 10;
    const codecs = input.codecs ?? ["h264", "hevc"];
    const size = input.size ?? "large";
    if (typeof durationSec !== "number" || !Number.isInteger(durationSec) || durationSec < 1 || durationSec > 120) throw new Error("durationSec must be 1..120");
    if (!Array.isArray(codecs) || !codecs.length || codecs.length > 2 || !codecs.every((x) => x === "h264" || x === "hevc")) throw new Error("codecs must contain h264 and/or hevc");
    if (!sizes.includes(size as typeof sizes[number])) throw new Error("Unsupported size");
    return { sourceUrl: url("sourceUrl", true), durationSec, codecs: [...new Set(codecs)], size };
  }
  if (kind === "transcribe") {
    if (Boolean(input.audioUrl) === Boolean(input.youtubeUrl)) throw new Error("Provide exactly one audioUrl or youtubeUrl");
    if (!["tiny", "base", "tiny.en", "base.en"].includes(String(input.model ?? "tiny.en"))) throw new Error("Unsupported model");
    return { audioUrl: url("audioUrl", true), youtubeUrl: url("youtubeUrl", true), model: input.model ?? "tiny.en" };
  }
  throw new Error("Unknown job kind");
}
