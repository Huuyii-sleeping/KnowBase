// Normalize explicit source groups only. Never supply a source the model omitted.
export function normalizeCitationMarkers(answer: string): string {
  return answer.replace(/\[S[^\]\n]*\]/g, (marker) => {
    const sources = marker
      .slice(1, -1)
      .split(/[,，、]/)
      .map((source) => source.trim());
    return sources.every((source) => /^S[1-9]\d*$/.test(source))
      ? sources.map((source) => `[${source}]`).join('')
      : marker;
  });
}
