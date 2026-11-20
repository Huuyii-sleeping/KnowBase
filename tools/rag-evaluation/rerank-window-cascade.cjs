// A fixed resource trigger, not an answerability threshold or probability.
function useLongWindow(shortScores) {
  if (!shortScores.length || shortScores.some((s) => !Number.isFinite(s)))
    throw new Error("Cascade requires complete finite scores");
  return Math.max(...shortScores) < 0;
}

module.exports = { useLongWindow };
