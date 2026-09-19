import { configured } from "@/lib/env";
import { pickBackend } from "@/lib/store";
import { readWriterStatus } from "@/lib/roast/status";

export const dynamic = "force-dynamic";

/** Operational status only: which services are configured and how the last writer call went. */
export async function GET() {
  const writer = await readWriterStatus();
  return Response.json(
    {
      store: pickBackend(),
      writerConfigured: configured.anthropic(),
      emailConfigured: configured.resend(),
      lastWriterCall: writer,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
