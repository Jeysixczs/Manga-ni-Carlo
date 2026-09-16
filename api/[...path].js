// Vercel serverless entry point. This wraps the exact same Express app used
// for a traditional Node deployment (see server/app.js) — no route logic is
// duplicated here, so the two deployment modes can't drift apart.
import app from '../server/app.js';

export default app;
