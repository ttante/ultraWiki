const suspiciousPatterns = [
  /ignore\s+previous\s+instructions/i,
  /system\s*:/i,
  /developer\s*:/i,
  /<\/?(system|assistant|user)>/i,
  /```/,
  /BEGIN\s+PROMPT/i
];

export const sanitizeSourceText = (input: string): { sanitized: string; flagged: boolean } => {
  let flagged = false;
  let sanitized = input;

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(sanitized)) {
      flagged = true;
      sanitized = sanitized.replace(pattern, '[FILTERED]');
    }
  }

  return { sanitized, flagged };
};

export const isLikelyWikipediaInput = (value: string): boolean => {
  if (!value.trim()) return false;
  if (/^https?:\/\//i.test(value)) {
    return /https?:\/\/(?:[a-z]+\.)?wikipedia\.org\/wiki\//i.test(value);
  }
  return true;
};
