// PDF rendering off the API thread: server.mjs sends {id, plan, meta}, this thread answers {id, ok, buf|error}.
// A render that runs too long is ended from outside (the whole thread is terminated and replaced).
import { parentPort } from 'node:worker_threads';
import { renderPlanPdf } from './pdf.mjs';

parentPort.on('message', async ({ id, plan, meta }) => {
  try { const buf = await renderPlanPdf(plan, meta); parentPort.postMessage({ id, ok: true, buf }); }
  catch (e) { parentPort.postMessage({ id, ok: false, error: String((e && e.message) || e) }); }
});
