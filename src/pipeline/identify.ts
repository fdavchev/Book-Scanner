/**
 * Turning OCR evidence into an identified book.
 *
 * This stage exists because the previous design could not rescue a bad reading. It built
 * one query from the detector's single best guess and accepted a catalogue result only if
 * that guess already agreed with it — so when the guess was right the lookup added
 * nothing, and when it was wrong the lookup could not help. Worse, a garbage guess like
 * "Ird" or "ITT" matches some real obscure book almost exactly, so the gate passed and the
 * scanner confidently attached a completely unrelated author. Three of the five matches it
 * made on the benchmark set were the wrong book. That is why turning the lookup on made
 * results *feel* worse than leaving it off.
 *
 * The replacement:
 *
 *   1. ask the catalogue several different ways (title+author, title, author, raw text)
 *   2. pool every returned edition
 *   3. score each one against **all** the OCR evidence, not against one chosen line
 *   4. accept only on corroboration that is too specific to be a coincidence
 *
 * Step 3 is what lets a cover whose title the detector got wrong still be identified: the
 * words "HOBBIT" and "FRR TOLKIEN" sit in the evidence pool whether or not the detector
 * picked them, and they corroborate *The Hobbit* by J.R.R. Tolkien overwhelmingly.
 */
import type { Detection, Hypothesis, OcrResult } from './types'
import { normalise, similarity, tokens } from './text'
import { searchOpenLibrary, type EnrichOptions, type OpenLibraryDoc } from './enrich'
import { isNoise, looksLikeName } from './candidates'

/**
 * How sure OCR must be of an author line before that line is allowed to rule a catalogue
 * entry out. Below it the reading is too damaged to contradict anything.
 *
 * Swept against all three fixture sets: at 80 a clearly-printed author was not trusted to
 * veto, and real books sharing a title ("Iron Harvest", "Cathedrals of Glass") replaced
 * correct authors; at 60 that stops without the damaged readings ("Charjoy Bro") starting
 * to veto correct matches.
 */
const TRUSTED_AUTHOR_CONFIDENCE = 60

/** Tokens shorter than this carry no identifying weight and are ignored when matching. */
const SIGNIFICANT_TOKEN = 4

/** Words that appear in so many titles that matching on them means nothing. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'to', 'for', 'at', 'by', 'from', 'with',
  'novel', 'book', 'story', 'tales', 'edition', 'vol', 'part', 'new', 'his', 'her', 'their',
  // Macedonian function words and the commonest cover nouns.
  'на', 'во', 'од', 'за', 'со', 'и', 'се', 'го', 'ги', 'роман', 'книга', 'издание',
])

function significantTokens(input: string): string[] {
  return tokens(input).filter((t) => t.length >= SIGNIFICANT_TOKEN && !STOPWORDS.has(t))
}

/**
 * Whether an OCR token and a catalogue token are the same word.
 *
 * OCR damage is overwhelmingly one or two substituted characters — "Neuromahcer",
 * "GATSRY", "MOCKINGRIRD" — so a small edit distance counts as a match, scaled to the
 * length of the word so that short words still have to be exact.
 */
export function tokenMatches(ocrToken: string, docToken: string): boolean {
  if (ocrToken === docToken) return true
  if (Math.abs(ocrToken.length - docToken.length) > 3) return false
  const allowed = docToken.length >= 8 ? 2 : docToken.length >= 5 ? 1 : 0
  if (allowed === 0) return false
  return similarity(ocrToken, docToken) >= 1 - allowed / docToken.length
}

/**
 * How much of a catalogue string the OCR evidence actually accounts for, 0–1.
 *
 * Every word counts, weighted by its length, including the short ones. Counting only the
 * long words made short titles indistinguishable: *The Road*, *On the Road* and *The Road
 * to Oz* each reduced to the single word "road" and all scored a perfect 1, so the
 * catalogue's own ordering decided which book you got. Weighting by length means the
 * unmatched "on", "to" and "oz" now cost those titles real score, and the book whose whole
 * cover was read wins.
 */
export function coverage(catalogueText: string, ocrTokens: string[]): number {
  const wanted = tokens(catalogueText)
  if (wanted.length === 0) return 0
  let total = 0
  let matched = 0
  for (const word of wanted) {
    // Length is the weight, except for the handful of words that appear in every other
    // title. Weighting "the" by its length made it a third of the identity of "The
    // Hobbit", so a cover that clearly read HOBBIT but dropped the article scored 0.67 and
    // was rejected. Stopwords still count for something, which is what keeps "The Road"
    // ahead of "The Road to Oz".
    const weight = STOPWORDS.has(word) ? 1 : Math.max(1, word.length)
    total += weight
    if (ocrTokens.some((o) => tokenMatches(o, word))) matched += weight
  }
  return total === 0 ? 0 : matched / total
}

/**
 * The part of a catalogue title before its subtitle.
 *
 * Covers print "Frankenstein"; the catalogue holds "Frankenstein; or, The Modern
 * Prometheus". Scoring the whole entry punished the cover for the words it sensibly left
 * off, and the correct book was rejected at 0.4 while two unrelated novels scored higher.
 */
export function mainTitle(title: string): string {
  const cut = title.split(/\s*[:;]\s*|\s+—\s+/)[0]
  return cut.trim().length >= 3 ? cut.trim() : title
}

/**
 * The share of a string's *identifying* words that were read, ignoring articles entirely.
 *
 * The weighted `coverage` above is the right measure for ranking, but it is too brittle as
 * an acceptance test: OCR misreading the word "and" left *Pride and Prejudice* at 0.93 and
 * the match was thrown away. Requiring every identifying word, and a high weighted score
 * as well, keeps that book while still rejecting "The Road to Oz" on a cover reading only
 * "THE ROAD".
 */
export function significantCoverage(catalogueText: string, ocrTokens: string[]): number {
  const wanted = significantTokens(catalogueText)
  if (wanted.length === 0) return 0
  return wanted.filter((w) => ocrTokens.some((o) => tokenMatches(o, w))).length / wanted.length
}

/** Which alphabet a string is mostly written in. */
export function dominantScript(input: string): 'cyrillic' | 'latin' | 'other' {
  const cyrillic = (input.match(/\p{Script=Cyrillic}/gu) ?? []).length
  const latin = (input.match(/\p{Script=Latin}/gu) ?? []).length
  if (cyrillic === 0 && latin === 0) return 'other'
  return cyrillic >= latin ? 'cyrillic' : 'latin'
}

/** The longest catalogue word that OCR actually saw — a 3-letter match proves nothing. */
function longestMatchedToken(catalogueText: string, ocrTokens: string[]): number {
  const matched = significantTokens(catalogueText).filter((w) =>
    ocrTokens.some((o) => tokenMatches(o, w)),
  )
  return matched.reduce((best, w) => Math.max(best, w.length), 0)
}

export interface ScoredDoc {
  doc: OpenLibraryDoc
  /** 0–1 corroboration of the catalogue title by the OCR evidence. */
  titleSupport: number
  /** 0–1 corroboration of the catalogue author. */
  authorSupport: number
  /** 0–1 overall. */
  score: number
  /** Why it was accepted or rejected, in words. */
  reason: string
  accepted: boolean
  /** The author is corroborated but the title is not — good enough to name the author. */
  authorOnly?: boolean
}

export interface EvidencePool {
  /** Every token OCR read anywhere, across every pass. */
  ocrTokens: string[]
  /** The detector's ranked interpretations. */
  hypotheses: Hypothesis[]
  /** Identifying words from the author lines the cover appears to show. */
  coverAuthorTokens: string[]
  /** Identifying words from the title the detector is most confident about. */
  coverTitleTokens: string[]
}

export function buildEvidence(result: OcrResult, ranked: Hypothesis[]): EvidencePool {
  // Blurbs, imprints and review-page attributions are excluded from the evidence pool as
  // well as from the candidate lines. They are real words that OCR reads confidently, and
  // letting them corroborate a catalogue entry is how a cover quoting the Village Voice
  // came back identified as "The Village Voice Film Guide".
  const fromLines = tokens(
    result.lines
      .filter((l) => !isNoise(l.text))
      .map((l) => l.text)
      .join(' '),
  )
  const fromHypotheses = ranked.flatMap((h) => [...tokens(h.title), ...tokens(h.author)])
  // Only a *confidently read* author may contradict a catalogue entry. A mangled reading
  // must not: the cover of Jane Eyre plainly says "Charlotte Brontë", OCR rendered it
  // "Charjoy Bro", and treating that as a competing author vetoed the correct book. Every
  // hypothesis contributes, though, not just the top few — the highest-scoring readings
  // are often title-only, and taking three of those left the pool empty.
  const coverAuthorTokens = [
    ...new Set(
      ranked
        .filter((h) => (h.authorConfidence ?? 0) >= TRUSTED_AUTHOR_CONFIDENCE)
        .flatMap((h) => significantTokens(h.author)),
    ),
  ]
  const coverTitleTokens = significantTokens(ranked.find((h) => h.title)?.title ?? '')
  return {
    ocrTokens: [...new Set([...fromLines, ...fromHypotheses])],
    hypotheses: ranked,
    coverAuthorTokens,
    coverTitleTokens,
  }
}

/**
 * The queries to try, most specific first.
 *
 * Several are needed because the useful evidence is in a different place on every failed
 * cover: sometimes only the title is legible, sometimes only the author's surname, and
 * sometimes neither is picked correctly but both are somewhere in the raw text.
 */
/**
 * Strips everything a search engine might treat as syntax.
 *
 * OCR routinely emits stray quotes and brackets — a hypothesis author of `"harper Lee`
 * with one unbalanced quote made Open Library return zero results for every query built
 * from it, so a cover whose author had been read perfectly was never identified.
 */
export function sanitiseQuery(input: string): string {
  return input
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 1)
    .slice(0, 12)
    .join(' ')
}

export function buildQueries(evidence: EvidencePool, result: OcrResult, limit = 5): string[] {
  const queries: string[] = []
  const add = (raw: string) => {
    const cleaned = sanitiseQuery(raw)
    if (cleaned.length >= 4 && !queries.some((existing) => normalise(existing) === normalise(cleaned))) {
      queries.push(cleaned)
    }
  }

  // Ordering matters as much as the queries themselves. Grouping all the title+author
  // combinations first exhausted the budget before the plain author query was ever tried,
  // and the plain author query is the one that works when the title is unreadable — a
  // search for "Harper Lee" finds To Kill a Mockingbird, while "ockingbird harper Lee"
  // finds nothing at all. Broad and narrow queries are interleaved instead.
  const best = evidence.hypotheses[0]
  if (best?.title && best?.author) add(`${best.title} ${best.author}`)
  if (best?.author) add(best.author)
  if (best?.title) add(best.title)

  for (const h of evidence.hypotheses.slice(1, 4)) {
    if (h.author) add(h.author)
    if (h.title && h.author) add(`${h.title} ${h.author}`)
    if (h.title) add(h.title)
  }
  // The whole page, cleaned: the safety net for covers where the detector picked wrong
  // lines but the right words were read somewhere.
  const bagOfWords = significantTokens(result.text).slice(0, 8).join(' ')
  add(bagOfWords)

  return queries.slice(0, limit)
}

/** Scores one catalogue entry against the pooled OCR evidence. */
export function scoreDoc(doc: OpenLibraryDoc, evidence: EvidencePool): ScoredDoc {
  const { ocrTokens } = evidence
  // A subtitle the cover omits must not count against the match, but an exact match on the
  // full title should still rank highest — hence the slight discount on the short form.
  const full = doc.title ?? ''
  const short = mainTitle(full)
  const titleSupport = Math.max(coverage(full, ocrTokens), coverage(short, ocrTokens) * 0.98)
  const authorSupport = Math.max(
    0,
    ...(doc.author_name ?? []).map((a) => coverage(a, ocrTokens)),
  )
  const titleWordsRead = Math.max(
    significantCoverage(full, ocrTokens),
    significantCoverage(short, ocrTokens),
  )
  const longestTitleWord = longestMatchedToken(full, ocrTokens)
  const longestAuthorWord = Math.max(
    0,
    ...(doc.author_name ?? []).map((a) => longestMatchedToken(a, ocrTokens)),
  )

  // Among candidates the evidence supports equally, the widely-published book is the one
  // more likely to be in someone's hands. This only ever breaks ties — it is small enough
  // that it can never promote a book the cover does not corroborate.
  const popularity = Math.min(1, Math.log10((doc.edition_count ?? 1) + 1) / 3)
  const score = titleSupport * 0.6 + authorSupport * 0.36 + popularity * 0.04

  // A cover that plainly shows an author's name is evidence *against* every edition by
  // somebody else, no matter how well the title matches. There really is a novel called
  // "Iron Harvest", and one called "The Weight of Water" — matching on title alone
  // replaced correctly-read authors with the wrong writer on 6 of 15 covers.
  //
  // Two refinements stop this vetoing good matches. Words that also appear in the
  // catalogue title are dropped first, because a title the detector mistakenly filed
  // under "author" is not a competing author — that alone was rejecting *The Road*. And
  // the conflict must be total: if the catalogue's author appears anywhere in the OCR
  // text the reading agrees, however the detector assigned the roles.
  const docAuthorTokens = (doc.author_name ?? []).flatMap((a) => significantTokens(a))
  const docTitleTokens = significantTokens(doc.title ?? '')
  const competingAuthorTokens = evidence.coverAuthorTokens.filter(
    (cover) => !docTitleTokens.some((docToken) => tokenMatches(cover, docToken)),
  )
  const authorContradicted =
    competingAuthorTokens.length > 0 && docAuthorTokens.length > 0 && authorSupport === 0

  // Acceptance. Every branch demands at least one long, specific word — this is what
  // stops "Ird" and "ITT" matching a real book title and being believed.
  let accepted = false
  let reason: string
  if (titleSupport >= 0.75 && longestTitleWord >= 5 && authorSupport >= 0.5) {
    accepted = true
    reason = 'title and author both match what was read on the cover'
  } else if (titleWordsRead >= 1 && titleSupport >= 0.85 && longestTitleWord >= 6) {
    accepted = true
    reason = 'the whole title was read on the cover'
  } else if (titleWordsRead >= 1 && titleSupport >= 0.85 && longestTitleWord >= 4) {
    // Short titles — "Dune", "The Road", "Beloved" — can never reach a six-letter word,
    // so a complete match of a shorter one is accepted instead. Complete is the operative
    // word: nothing in the catalogue title may be unaccounted for.
    accepted = true
    reason = 'the whole title was read on the cover'
  } else if (titleSupport >= 0.5 && authorSupport >= 0.99 && longestAuthorWord >= 5) {
    accepted = true
    reason = 'the author matches and part of the title was read'
  } else if (authorSupport >= 0.99 && longestAuthorWord >= 6 && titleSupport >= 0.34) {
    accepted = true
    reason = 'the author’s name matches exactly'
  } else {
    reason =
      titleSupport + authorSupport === 0
        ? 'nothing on the cover matches this book'
        : 'too little of this book matches what was read'
  }

  if (authorContradicted && accepted) {
    accepted = false
    reason = 'the cover names a different author, so this is a different book'
  }

  // Corroboration has to run both ways. `coverage` only asks whether the catalogue's words
  // were read, so a book called *Thirteen* scored a flawless 1 against a cover that plainly
  // said "Thirteen Doors". A word the cover shows and the catalogue entry cannot account
  // for — in its title *or* its author, since the detector often confuses the two — means
  // this is a different book.
  // A catalogue title that is simply a person's name, matched off a cover where that name
  // was read but the catalogue's own author was not, is a book *about* that person. A
  // photograph of Anna Karenina taken at a steep angle yielded only "LEO TOLSTOY" and was
  // identified as Chesterton's biography of him.
  const titleWordsMatched = significantTokens(doc.title ?? '').filter((w) =>
    ocrTokens.some((o) => tokenMatches(o, w)),
  ).length
  if (accepted && authorSupport === 0 && looksLikeName(doc.title ?? '') > 0.7 && titleWordsMatched < 2) {
    // The qualifier matters: plenty of real titles *are* names — Jane Eyre, Anna Karenina.
    // What separates them is how many identifying words of that name the cover actually
    // shows. Two ("jane", "eyre") means the cover really does say it. One ("tolstoy"),
    // with the catalogue's author nowhere on the cover, means a book *about* Tolstoy.
    accepted = false
    reason = 'this looks like a book about that name, not by it'
  }

  // A Macedonian edition usually exists in the catalogue only as its English original, so
  // matching on the author would quietly replace "Авантурите на Шерлок Холмс" with "The
  // Adventures of Sherlock Holmes". The book on the shelf says the former. The catalogue
  // may still name the author — that goes through the author-only path below.
  const coverScript = dominantScript(evidence.ocrTokens.join(' '))
  if (accepted && coverScript !== 'other' && dominantScript(doc.title ?? '') !== coverScript) {
    accepted = false
    reason = 'this is the same book in another language — keeping the title on the cover'
  }

  if (accepted && evidence.coverTitleTokens.length >= 2) {
    const docWords = tokens(`${doc.title ?? ''} ${(doc.author_name ?? []).join(' ')}`)
    const explained = evidence.coverTitleTokens.filter((cover) =>
      docWords.some((docWord) => tokenMatches(cover, docWord)),
    ).length
    if (explained / evidence.coverTitleTokens.length < 0.75) {
      accepted = false
      reason = 'the cover shows words this book does not account for'
    }
  }

  // A distinctive surname read cleanly off the cover identifies the *author* even when the
  // title is unreadable — "F. SCOTT FITZGERALD" and "HARPER LEE" were both read perfectly
  // on covers whose titles OCR could not manage. Claiming the author while offering that
  // author's books as choices is far more useful than reporting nothing, and far more
  // honest than guessing which of their books it is.
  const authorOnly =
    !accepted &&
    !authorContradicted &&
    authorSupport >= 0.6 &&
    longestAuthorWord >= 6 &&
    titleSupport < 0.99

  return { doc, titleSupport, authorSupport, score, reason, accepted, authorOnly }
}

export interface IdentifyResult {
  detection: Detection
  matched: boolean
  /** The author was corroborated even though the book was not identified. */
  identifiedAuthor?: boolean
  /** Everything considered, best first — shown in the review card's alternatives. */
  ranked: ScoredDoc[]
  queries: string[]
  error?: string
}

export interface IdentifyOptions extends EnrichOptions {
  /** Called with each query as it is tried. */
  onQuery?: (query: string, index: number, total: number) => void
  /** Consulted before the network, and filled in after a successful lookup. */
  cache?: LookupCache
  /** Give up on the whole lookup after this long. Default 8s. */
  budgetMs?: number
}

export interface LookupCache {
  get(query: string): Promise<OpenLibraryDoc[] | undefined>
  set(query: string, docs: OpenLibraryDoc[]): Promise<void>
}

/**
 * Identifies a book from the OCR evidence, using the catalogue as corroboration.
 *
 * Always resolves. A network failure, a timeout or no acceptable match all fall back to
 * the best offline reading rather than losing the book — the scan is never wasted.
 */
/**
 * One retry on a transient failure.
 *
 * Open Library throttles a client that asks too much too fast, and the failure surfaces as
 * a bare `Failed to fetch`. A single short backoff recovers almost all of them; anything
 * beyond that is a real outage and the scan falls back to the offline reading.
 */
/** Politeness gap between successive catalogue queries for one cover. */
const QUERY_SPACING_MS = 250

/**
 * The form of the title to show: the short one when that is what the cover corroborates,
 * the full one when the subtitle was read too.
 */
function preferredTitle(winner: ScoredDoc, ocrTokens: string[]): string {
  const full = winner.doc.title ?? ''
  const short = mainTitle(full)
  if (short === full) return full
  return significantCoverage(full, ocrTokens) >= 0.99 ? full : short
}

/** De-duplicates the pooled results and scores them, best first. */
function rank(docs: OpenLibraryDoc[], evidence: EvidencePool): ScoredDoc[] {
  const seen = new Set<string>()
  return docs
    .filter((d) => {
      const key = `${normalise(d.title ?? '')}|${normalise(d.author_name?.[0] ?? '')}`
      if (!d.title || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((doc) => scoreDoc(doc, evidence))
    .sort((a, b) => Number(b.accepted) - Number(a.accepted) || b.score - a.score)
}

async function searchWithRetry(
  query: string,
  options: IdentifyOptions,
  delayMs = 400,
): Promise<OpenLibraryDoc[]> {
  try {
    return await searchOpenLibrary(query, { ...options, limit: 5 })
  } catch {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    return searchOpenLibrary(query, { ...options, limit: 5 })
  }
}

export async function identify(
  result: OcrResult,
  ranked: Hypothesis[],
  offline: Detection,
  options: IdentifyOptions = {},
): Promise<IdentifyResult> {
  const evidence = buildEvidence(result, ranked)
  const queries = buildQueries(evidence, result)
  if (queries.length === 0) {
    return { detection: offline, matched: false, ranked: [], queries: [] }
  }

  const deadline = Date.now() + (options.budgetMs ?? 8000)
  const docs: OpenLibraryDoc[] = []
  const errors: string[] = []

  // Queries are issued one at a time and scored as they land, stopping the moment the
  // evidence identifies a book. Firing all of them up front and scoring afterwards made
  // five network calls for every cover even when the first already had the answer — slow,
  // and enough traffic that Open Library began refusing requests outright, which reaches
  // the browser as a bare "Failed to fetch".
  for (const [index, query] of queries.entries()) {
    if (Date.now() > deadline) break
    options.onQuery?.(query, index, queries.length)
    try {
      const cached = await options.cache?.get(query)
      if (cached) {
        docs.push(...cached)
      } else {
        if (index > 0) await new Promise((resolve) => setTimeout(resolve, QUERY_SPACING_MS))
        const found = await searchWithRetry(query, options)
        docs.push(...found)
        await options.cache?.set(query, found)
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
      continue
    }
    if (rank(docs, evidence).some((s) => s.accepted)) break
  }

  const scored = rank(docs, evidence)

  const winner = scored.find((s) => s.accepted)
  if (!winner) {
    // Nothing is corroborated well enough to name the book. If the author is, say so and
    // offer that author's books rather than throwing the lookup away entirely.
    const byAuthor = scored.filter((s) => s.authorOnly)
    const namedAuthor = byAuthor[0]
    if (namedAuthor) {
      const titlesByAuthor = [
        ...new Set(byAuthor.map((s) => s.doc.title ?? '').filter(Boolean)),
      ].slice(0, 5)
      return {
        matched: false,
        identifiedAuthor: true,
        ranked: scored.slice(0, 5),
        queries,
        error: errors[0],
        detection: {
          ...offline,
          author: namedAuthor.doc.author_name?.[0] ?? offline.author,
          // Deliberately modest: the author is known, the book is not.
          confidence: Math.min(offline.confidence, 45),
          reason: `the author matches Open Library, but the title could not be read — pick it from the list`,
          source: 'openlibrary',
          titleAlternates: [
            ...new Set([...titlesByAuthor, ...offline.titleAlternates].filter(Boolean)),
          ].slice(0, 5),
        },
      }
    }
    return {
      detection: offline,
      matched: false,
      ranked: scored.slice(0, 5),
      queries,
      error: errors[0],
    }
  }

  return {
    matched: true,
    ranked: scored.slice(0, 5),
    queries,
    error: errors[0],
    detection: {
      ...offline,
      // Shown the way the book shows itself. The catalogue holds "Frankenstein; or, The
      // Modern Prometheus"; the cover, and the reader, say "Frankenstein".
      title: preferredTitle(winner, evidence.ocrTokens),
      author: winner.doc.author_name?.[0] ?? offline.author,
      // The catalogue agreeing is strong evidence, but the floor is the corroboration
      // actually measured — never a flat "we found something so it must be right".
      confidence: Math.round(Math.min(98, 55 + winner.score * 45)),
      reason: `Open Library: ${winner.reason}`,
      source: 'openlibrary',
      titleAlternates: [
        ...new Set(
          [offline.title, ...scored.slice(0, 4).map((s) => s.doc.title ?? '')].filter(
            (t) => t && t !== winner.doc.title,
          ),
        ),
      ].slice(0, 4),
      authorAlternates: [
        ...new Set(
          [offline.author, ...scored.slice(0, 4).map((s) => s.doc.author_name?.[0] ?? '')].filter(
            (a) => a && a !== winner.doc.author_name?.[0],
          ),
        ),
      ].slice(0, 4),
    },
  }
}
