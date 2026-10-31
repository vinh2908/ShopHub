// Recommendation / review "services" kept OUT of the order path on purpose.
// The order flow never calls them synchronously, so if they time out or
// fail, ordering still works. The web page calls them optionally and
// falls back to an empty list. This is the failure-isolation demo.
async function getRecommendations(productId, { fail = false } = {}) {
  if (fail) throw new Error("RECOMMENDATION_SERVICE_DOWN");
  await new Promise((r) => setTimeout(r, 30));
  // Simple history-based placeholder: same-category neighbours would go
  // here in a real system. Kept deliberately simple and honest.
  return [{ note: "Simple history-based placeholder (no ML model)", productId }];
}

function getReviews(productId, { fail = false } = {}) {
  if (fail) throw new Error("REVIEW_SERVICE_DOWN");
  return [{ productId, rating: 5, comment: "San pham dac san, dong goi can than (review mau)." }];
}

module.exports = { getRecommendations, getReviews };
