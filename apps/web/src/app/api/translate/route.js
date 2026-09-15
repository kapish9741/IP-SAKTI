import { GoogleCloudTranslationProvider } from "../../../lib/translation.mjs";
import { createTranslationHandler } from "../../../lib/translation-route.mjs";

const handler = createTranslationHandler({
  provider: new GoogleCloudTranslationProvider(),
});

export const runtime = "nodejs";
export const POST = handler;
