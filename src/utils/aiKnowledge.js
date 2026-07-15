// Lightweight keyword-overlap search over the AI Q&A knowledge base.
// No external AI call is needed for a training simulator — this keeps the
// bot's "search the knowledge base first" behavior fast, offline, and easy
// for trainers to reason about (score = matching words, simple and visible).

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'i', 'my', 'me', 'to', 'of', 'in', 'on',
  'for', 'and', 'or', 'do', 'does', 'did', 'have', 'has', 'had', 'it', 'this', 'that',
  'with', 'why', 'how', 'what', 'when', 'can', 'you', 'please', 'help', 'not', 'no',
])

function tokenize(text) {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
}

/**
 * Scores every active knowledge entry against the query and returns the best
 * match, or null if nothing scores above the minimum threshold.
 * entries: rows from `ai_knowledge` (question, answer, keywords[]).
 */
export function searchKnowledge(query, entries, { categoryId = null, minScore = 1 } = {}) {
  const queryWords = new Set(tokenize(query))
  if (queryWords.size === 0) return null

  let best = null
  let bestScore = 0

  for (const entry of entries) {
    if (entry.active === false) continue

    const haystack = [
      ...tokenize(entry.question),
      ...tokenize(entry.answer),
      ...(entry.keywords ?? []).map((k) => k.toLowerCase()),
    ]
    let score = 0
    for (const word of queryWords) {
      if (haystack.includes(word)) score += 1
    }
    // Small boost for entries scoped to the customer's current category.
    if (categoryId && entry.category_id === categoryId) score += 0.5

    if (score > bestScore) {
      bestScore = score
      best = entry
    }
  }

  return bestScore >= minScore ? best : null
}
