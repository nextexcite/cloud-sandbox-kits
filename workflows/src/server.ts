import express from "express";
import { serve } from "inngest/express";
import { capture, inngest } from "./capture.js";
import { mediaFunctions } from "./media.js";

const app = express();
app.use(express.json());
app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api/inngest", serve({ client: inngest, functions: [capture, ...mediaFunctions] }));
app.listen(3000, "127.0.0.1", () => console.log("App ready on http://localhost:3000"));
