import { sanitizeSourceText } from './security.js';

export type ParsedInput = {
  title: string;
  url: string;
};

export type SourceSection = {
  heading: string;
  content: string;
};

export type IngestedPage = {
  revisionId: string;
  title: string;
  sections: SourceSection[];
};

export const parseTopicInput = (input: string, language: string): ParsedInput => {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Input cannot be empty');
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    if (url.hostname !== `${language}.wikipedia.org`) {
      throw new Error('Only English Wikipedia URLs are supported in MVP');
    }

    const match = url.pathname.match(/^\/wiki\/(.+)$/);
    if (!match) {
      throw new Error('Wikipedia URL must include /wiki/<title> path');
    }

    const title = decodeURIComponent(match[1]).replace(/_/g, ' ');
    return { title, url: trimmed };
  }

  const normalizedTitle = trimmed.replace(/\s+/g, ' ');
  const url = `https://${language}.wikipedia.org/wiki/${encodeURIComponent(normalizedTitle.replace(/\s/g, '_'))}`;
  return { title: normalizedTitle, url };
};

export const fetchWikipediaSections = async (title: string, language: string): Promise<IngestedPage> => {
  const endpoint = `https://${language}.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&format=json&prop=text|revid`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Wikipedia fetch failed with status ${response.status}`);
  }

  const body = (await response.json()) as {
    parse?: { revid?: number; title?: string; text?: { '*': string } };
    error?: { info?: string };
  };

  if (body.error || !body.parse?.text?.['*']) {
    throw new Error(body.error?.info ?? 'Missing parse payload from Wikipedia');
  }

  const html = body.parse.text['*'];
  const stripped = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const { sanitized, flagged } = sanitizeSourceText(stripped);
  const content = flagged ? `${sanitized}\n\n[Security note: suspicious source patterns sanitized]` : sanitized;

  return {
    revisionId: String(body.parse.revid ?? 'unknown'),
    title: body.parse.title ?? title,
    sections: [
      {
        heading: 'Overview',
        content
      }
    ]
  };
};
