export const searchParamsToRecord = (params: URLSearchParams): Record<string, string | string[]> => {
  const result: Record<string, string | string[]> = {};
  for (const key of new Set(Array.from(params.keys()))) {
    const values = params.getAll(key);
    result[key] = values.length === 1 ? values[0] : [...values];
  }
  return result;
};
