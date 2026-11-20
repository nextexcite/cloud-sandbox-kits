import express from "express";
import { serve } from "inngest/express";
import { capture, inngest } from "./capture.js";
import { cleanupCancelledMedia, mediaFunctions } from "./media.js";

const app = express();
app.use(express.json());
app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api/inngest", serve({ client: inngest, functions: [capture, ...mediaFunctions, cleanupCancelledMedia] }));
const port = Number(process.env.PORT ?? 3000);
app.listen(port, "0.0.0.0", () => console.log(`App ready on port ${port}`));
