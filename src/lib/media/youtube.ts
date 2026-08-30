/**
 * Reading a YouTube video id out of whatever an administrator pasted.
 *
 * ── Why an id and never a URL ───────────────────────────────────────────────────────────────────
 * What gets STORED and what gets RENDERED is an eleven-character id, not a URL and never a fragment
 * of HTML. That is the whole safety property: the embed src is built here, from a validated id, so
 * there is no path by which a pasted value becomes an arbitrary iframe. A field that accepted markup
 * would be a way to publish a script tag through a settings panel.
 *
 * ── What it accepts ─────────────────────────────────────────────────────────────────────────────
 * Every form somebody actually has in their clipboard: a watch URL, a share link, an embed URL, a
 * Shorts link, a live link, and a bare id. Anything else is refused rather than guessed at — a
 * half-understood URL that renders the wrong video is worse than one that says it is wrong.
 *
 * No `www.` juggling and no suffix matching: the host must be one of the known ones exactly, because
 * `youtube.com.example.net` ends with a trusted string.
 */

/** The hosts a YouTube link may legitimately have. Exact matches only. */
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])

/**
 * A YouTube id is exactly eleven characters of the URL-safe base64 alphabet.
 *
 * Anchored at both ends. Without the anchors `abc/../../etc` matches in the middle and an id that
 * escapes its own path is exactly the thing this is here to prevent.
 */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/**
 * The id in a pasted value, or null.
 *
 * Null is a real answer and the caller renders it as "that is not a YouTube link" rather than
 * falling back to something. Silently substituting a default video would put a video on the page
 * that nobody chose.
 */
export function youtubeVideoId(raw: string): string | null {
  const value = (raw ?? '').trim()
  if (!value) return null

  // A bare id, which is what the field stores once it has been read.
  if (VIDEO_ID.test(value)) return value

  let url: URL
  try {
    // A scheme-less paste is common and unambiguous; anything else must carry its own scheme.
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null

  // youtu.be/<id>
  if (url.hostname.toLowerCase().endsWith('youtu.be')) {
    return firstSegment(url.pathname)
  }

  // youtube.com/watch?v=<id>
  const v = url.searchParams.get('v')
  if (v && VIDEO_ID.test(v)) return v

  // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length >= 2 && ['embed', 'shorts', 'live', 'v'].includes(parts[0])) {
    return VIDEO_ID.test(parts[1]) ? parts[1] : null
  }

  return null
}

function firstSegment(pathname: string): string | null {
  const seg = pathname.split('/').filter(Boolean)[0] ?? ''
  return VIDEO_ID.test(seg) ? seg : null
}

/** Whether a pasted value is a YouTube link this site will embed. */
export function isYoutubeUrl(raw: string): boolean {
  return youtubeVideoId(raw) !== null
}

/**
 * The embed URL, built here rather than stored.
 *
 * `youtube-nocookie.com` is the privacy-enhanced host: it does not set tracking cookies until the
 * visitor actually plays something, which matters because this player is on the front page and every
 * visitor loads it.
 *
 * `autoplay=1` is correct HERE and only here: it is appended after somebody has pressed Play, so the
 * video starts because they asked it to. Nothing autoplays on page load — the iframe does not exist
 * until the button is pressed.
 *
 * `mute=1` is unconditional. A record run is watched for what happens on the table, and a homepage
 * that starts making noise the moment somebody clicks is the thing people close the tab over —
 * particularly the ones who clicked it at work. The player's own unmute control is one press away
 * for anybody who wants the sound, so nothing is taken from them.
 */
export function youtubeEmbedUrl(videoId: string, options: { autoplay?: boolean } = {}): string {
  const id = youtubeVideoId(videoId)
  if (!id) throw new Error('Not a YouTube video id.')
  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
    mute: '1',
  })
  if (options.autoplay) params.set('autoplay', '1')
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`
}

/** Where to send somebody whose browser will not frame the player. */
export function youtubeWatchUrl(videoId: string): string {
  const id = youtubeVideoId(videoId)
  if (!id) throw new Error('Not a YouTube video id.')
  return `https://www.youtube.com/watch?v=${id}`
}

/**
 * Thumbnails, best first.
 *
 * `maxresdefault` does not exist for every video — it is only generated for sources uploaded above a
 * certain resolution — and a missing one serves a 120×90 grey placeholder rather than a 404, so it
 * cannot be detected by an error handler alone. `hqdefault` is generated for every video without
 * exception, so it is the floor.
 *
 * The caller tries them in order; see the facade's `onError`.
 */
export function youtubeThumbnails(videoId: string): string[] {
  const id = youtubeVideoId(videoId)
  if (!id) return []
  return [
    `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/sddefault.jpg`,
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  ]
}

/** The host the thumbnails come from, for the image configuration that has to allow it. */
export const YOUTUBE_THUMBNAIL_HOST = 'i.ytimg.com'
