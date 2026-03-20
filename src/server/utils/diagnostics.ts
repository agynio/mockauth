export type DiagnosticParams = Record<string, string | string[]>;

export const collectHeaders = (headers: Headers): Record<string, string> => {
  return Object.fromEntries(headers.entries());
};

export const collectParams = (entries: Iterable<[string, string]>): DiagnosticParams => {
  const params: DiagnosticParams = {};
  for (const [key, value] of entries) {
    const existing = params[key];
    if (existing === undefined) {
      params[key] = value;
      continue;
    }
    if (Array.isArray(existing)) {
      existing.push(value);
      continue;
    }
    params[key] = [existing, value];
  }
  return params;
};
