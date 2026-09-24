import { v2 as translateV2 } from "@google-cloud/translate";

export const SUPPORTED_LANGUAGE_CODES = new Set([
  "en",
  "hi",
  "sa",
  "mr",
  "ta",
  "te",
  "bn",
  "gu",
  "kn",
  "pa",
]);

export function googleClientOptionsFromEnvironment(env = {}) {
  const jsonCreds =
    env.GOOGLE_APPLICATION_CREDENTIALS_JSON ||
    env.GOOGLE_CREDENTIALS ||
    env.GOOGLE_CLOUD_CREDENTIALS ||
    (env.GOOGLE_APPLICATION_CREDENTIALS?.trim().startsWith("{")
      ? env.GOOGLE_APPLICATION_CREDENTIALS
      : null);

  if (jsonCreds) {
    try {
      const parsed =
        typeof jsonCreds === "string" ? JSON.parse(jsonCreds) : jsonCreds;
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        let privateKey = parsed.private_key;
        if (typeof privateKey === "string") {
          privateKey = privateKey.trim();
          if (
            (privateKey.startsWith('"') && privateKey.endsWith('"')) ||
            (privateKey.startsWith("'") && privateKey.endsWith("'"))
          ) {
            privateKey = privateKey.slice(1, -1);
          }
          privateKey = privateKey.replace(/\\n/g, "\n");
        }
        return {
          projectId: parsed.project_id,
          credentials: {
            client_email: parsed.client_email,
            private_key: privateKey,
          },
        };
      }
    } catch {
      // Fall through to individual environment variables
    }
  }

  const projectId = (
    env.GOOGLE_CLOUD_PROJECT_ID ||
    env.GOOGLE_PROJECT_ID ||
    env.GCP_PROJECT_ID ||
    env.PROJECT_ID
  )?.trim();

  const clientEmail = (
    env.GOOGLE_CLOUD_CLIENT_EMAIL ||
    env.GOOGLE_CLIENT_EMAIL ||
    env.GCP_CLIENT_EMAIL ||
    env.CLIENT_EMAIL
  )?.trim();

  let privateKey =
    env.GOOGLE_CLOUD_PRIVATE_KEY ||
    env.GOOGLE_PRIVATE_KEY ||
    env.GCP_PRIVATE_KEY ||
    env.PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) return {};

  if (typeof privateKey === "string") {
    privateKey = privateKey.trim();
    if (
      (privateKey.startsWith('"') && privateKey.endsWith('"')) ||
      (privateKey.startsWith("'") && privateKey.endsWith("'"))
    ) {
      privateKey = privateKey.slice(1, -1);
    }
    privateKey = privateKey.replace(/\\n/g, "\n");
  }

  return {
    projectId,
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
  };
}

const BUILT_IN_PROTECTED_PATTERNS = [
  /\[\d+\]/gu,
  /https?:\/\/[^\s<>"]+/gu,
  /\b\d{4}-\d{2}-\d{2}\b/gu,
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gu,
  /\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/giu,
  /\b(?:Section|Article|Rule|Regulation|Schedule|Clause|Form)\s+[A-Za-z0-9()./-]+/giu,
  /\b\d+\s*[–—-]\s*\d+\b/gu,
];

const URL_TRAILING_PUNCTUATION = /[.,!?;:]+$/u;

function collectExactTermRanges(text, protectedTerms) {
  const ranges = [];
  const terms = [...new Set(protectedTerms)]
    .filter((term) => typeof term === "string" && term.length > 0)
    .sort((left, right) => right.length - left.length);

  for (const term of terms) {
    let fromIndex = 0;
    while (fromIndex < text.length) {
      const start = text.indexOf(term, fromIndex);
      if (start === -1) break;
      ranges.push({ start, end: start + term.length });
      fromIndex = start + term.length;
    }
  }
  return ranges;
}

function collectPatternRanges(text) {
  const ranges = [];
  for (const pattern of BUILT_IN_PROTECTED_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      let value = match[0];
      if (value.startsWith("http")) {
        value = value.replace(URL_TRAILING_PUNCTUATION, "");
      }
      if (value) {
        ranges.push({ start: match.index, end: match.index + value.length });
      }
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  }
  return ranges;
}

function mergeRanges(ranges) {
  const ordered = ranges.sort(
    (left, right) => left.start - right.start || right.end - left.end,
  );
  const merged = [];

  for (const range of ordered) {
    const previous = merged.at(-1);
    if (!previous || range.start >= previous.end) {
      merged.push({ ...range });
    } else if (range.end > previous.end) {
      previous.end = range.end;
    }
  }
  return merged;
}

export function splitProtectedSegments(text, protectedTerms = []) {
  if (typeof text !== "string" || text.length === 0) return [];

  const ranges = mergeRanges([
    ...collectExactTermRanges(text, protectedTerms),
    ...collectPatternRanges(text),
  ]);
  if (ranges.length === 0) return [{ text, protected: false }];

  const segments = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push({ text: text.slice(cursor, range.start), protected: false });
    }
    segments.push({ text: text.slice(range.start, range.end), protected: true });
    cursor = range.end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), protected: false });
  }
  return segments;
}

export class GoogleCloudTranslationProvider {
  constructor({ client, env } = {}) {
    this.customClient = client;
    this.env = env;
  }

  getClient() {
    if (this.customClient) return this.customClient;
    const currentEnv = this.env || process.env;
    return new translateV2.Translate(
      googleClientOptionsFromEnvironment(currentEnv),
    );
  }

  async translate({
    text,
    sourceLanguage,
    targetLanguage,
    protectedTerms = [],
  }) {
    if (sourceLanguage === targetLanguage) return text;

    const segments = splitProtectedSegments(text, protectedTerms);
    const translatableIndexes = segments.flatMap((segment, index) =>
      !segment.protected && /\p{L}/u.test(segment.text) ? [index] : [],
    );
    if (translatableIndexes.length === 0) return text;

    const translatableParts = translatableIndexes.map((index) => {
      const match = segments[index].text.match(/^(\s*)([\s\S]*?)(\s*)$/u);
      return {
        leading: match[1],
        text: match[2],
        trailing: match[3],
      };
    });
    const translatableText = translatableParts.map((part) => part.text);
    const client = this.getClient();
    const [translated] = await client.translate(translatableText, {
      from: sourceLanguage,
      to: targetLanguage,
      format: "text",
    });
    const translatedText = Array.isArray(translated) ? translated : [translated];
    if (translatedText.length !== translatableIndexes.length) {
      throw new Error("Translation provider returned an incomplete response.");
    }

    translatableIndexes.forEach((segmentIndex, translatedIndex) => {
      const boundary = translatableParts[translatedIndex];
      segments[segmentIndex] = {
        text: `${boundary.leading}${translatedText[translatedIndex]}${boundary.trailing}`,
        protected: false,
      };
    });
    return segments.map((segment) => segment.text).join("");
  }
}
