import 'server-only'
import { UPLOAD_MAX_BYTES } from './limits'
import sharp from 'sharp'

/**
 * What may be uploaded through the article editor, and what is done to it first.
 *
 * The rule that shapes this file: a filename and a declared content type are things the CLIENT said,
 * and neither is evidence. Every decision here is made from the bytes. A file called `photo.png` that
 * begins with `<?xml` is an SVG, and an SVG is script — so the type is read from the file signature
 * and the client's claims are used for nothing except a hint in an error message.
 *
 * Still images are re-encoded, which is what removes EXIF: rather than trying to strip individual
 * tags, the pixels are decoded and written out fresh, so location, device and timestamp metadata are
 * simply not carried across. GIFs are deliberately NOT re-encoded frame-by-frame — they are validated
 * and passed through, because flattening an animation into its first frame would silently destroy
 * what the author pasted.
 */

/**
 * The formats that may be uploaded. SVG is absent on purpose: it can carry script.
 *
 * AVIF joined the list for profile avatars — it is a still-image format modern phones export and
 * sharp decodes it, so refusing it only pushed people to convert files by hand.
 */
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'] as const
export type AllowedType = (typeof ALLOWED_TYPES)[number]

/** Ceilings. Generous for a screenshot or a photo, small enough that one paste cannot fill a disk. */
/*
  The ceiling, and why it is no longer 12 MB.

  It never was 12 MB in practice. An upload arrives through a Server Action, so the framework's body
  limit is reached long before this one and refuses the request in a way no component can catch. A
  validator that promises more than the transport will carry does not protect anything; it just
  moves the failure somewhere it cannot be explained. `UPLOAD_MAX_BYTES` is the number every layer
  now uses, and it sits under Vercel's own 4.5 MB cap on a request body.

  Still overridable by environment for a deployment that is not on Vercel, but it cannot be raised
  above what the transport allows without also raising `serverActions.bodySizeLimit`.
*/
export const MAX_BYTES = Number(process.env.MEDIA_MAX_BYTES ?? UPLOAD_MAX_BYTES)
export const MAX_DIMENSION = Number(process.env.MEDIA_MAX_DIMENSION ?? 6000)
/** Animated files are larger by nature, so they get their own, higher ceiling. */
export const MAX_GIF_BYTES = Number(process.env.MEDIA_MAX_GIF_BYTES ?? UPLOAD_MAX_BYTES)

export class MediaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaError'
  }
}

export interface ValidatedMedia {
  buffer: Buffer
  mimeType: AllowedType
  extension: string
  width: number | null
  height: number | null
  animated: boolean
}

// --------------------------------------------------------------------------- signatures

/**
 * Identify a file from its leading bytes.
 *
 * Returns null for anything unrecognised, which the caller turns into a refusal. Deliberately a small
 * closed list rather than a general sniffer: the question is not "what is this file" but "is this one
 * of the four things we accept".
 */
export function sniffImageType(buffer: Buffer): AllowedType | null {
  if (buffer.length < 12) return null

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }

  // GIF: "GIF87a" or "GIF89a"
  const head6 = buffer.subarray(0, 6).toString('latin1')
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'image/gif'

  // WebP: "RIFF" .... "WEBP"
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF'
    && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp'
  }

  /*
    AVIF: an ISO-BMFF file whose `ftyp` brand is `avif` (still) or `avis` (sequence).

    The box length occupies the first four bytes, so the brand is read at offset 8 rather than from
    the very start. Checked here rather than left to the decoder because the whole point of this
    function is that the TYPE is decided by the bytes, not by what the upload claimed.
  */
  if (buffer.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('latin1')
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
  }

  return null
}

/**
 * Does this look like markup rather than an image?
 *
 * A belt-and-braces check in front of the signature test. An SVG has no binary magic number, so it
 * would already fail `sniffImageType` — but saying "that is an SVG, and SVGs are not accepted" is a
 * far more useful refusal than "unrecognised file", and it makes the intent explicit to a reader.
 */
export function looksLikeMarkup(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 256).toString('latin1').trimStart().toLowerCase()
  return head.startsWith('<?xml') || head.startsWith('<svg') || head.startsWith('<!doctype') || head.startsWith('<html')
}

const EXTENSIONS: Record<AllowedType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

/** Formats that can carry more than one frame, and so must never be re-encoded blindly. */
const CAN_ANIMATE = new Set<AllowedType>(['image/gif', 'image/webp', 'image/avif'])

// --------------------------------------------------------------------------- filenames

/**
 * A safe storage name.
 *
 * Path separators, traversal sequences, control characters and leading dots are all removed rather
 * than escaped, and the extension is taken from the SNIFFED type rather than from whatever the client
 * sent — so a file cannot claim to be a `.png` and be stored under a name that says so while holding
 * something else.
 */
export function safeFilename(original: string | null | undefined, type: AllowedType): string {
  const base = String(original ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .pop() ?? ''

  const stem = base
    .replace(/\.[^.]*$/, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    // Every remaining dot goes. `a.php.png` would otherwise be stored as `a.php-<stamp>.png`, which
    // is harmless here — Payload serves it as an image either way — but a stored name containing
    // another format's extension is the kind of thing that becomes a problem on some future server
    // that decides extensions mean something. The one dot in the final name is the one this function
    // puts there, from the sniffed type.
    .replace(/\./g, '-')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-]+/, '')
    .replace(/-+$/g, '')
    .slice(0, 60)
    .toLowerCase()

  // A short random suffix so two pastes of "screenshot.png" cannot collide, and so a stored name is
  // never guessable from the article alone.
  const unique = Math.random().toString(36).slice(2, 8)
  const name = stem || 'pasted'
  return `${name}-${Date.now().toString(36)}${unique}.${EXTENSIONS[type]}`
}

// --------------------------------------------------------------------------- validation

/**
 * Validate and normalise an uploaded image.
 *
 * Order matters. Size is checked before anything decodes the file, so a hostile 500MB upload is
 * refused without being handed to an image library. The type comes from the bytes. Dimensions come
 * from the decoder, which is also the first thing that would reject a malformed file.
 */
export async function validateImage(input: Buffer): Promise<ValidatedMedia> {
  if (!input || input.length === 0) throw new MediaError('That file was empty.')

  if (looksLikeMarkup(input)) {
    throw new MediaError('SVG and HTML files are not accepted. Use a JPG, PNG, WebP, AVIF or GIF.')
  }

  const mimeType = sniffImageType(input)
  if (!mimeType) {
    throw new MediaError('That file is not a JPG, PNG, WebP, AVIF or GIF.')
  }

  // Animation-capable formats get the higher ceiling; a filmstrip is legitimately larger.
  const ceiling = CAN_ANIMATE.has(mimeType) ? MAX_GIF_BYTES : MAX_BYTES
  if (input.length > ceiling) {
    throw new MediaError(`That image is larger than ${Math.round(ceiling / (1024 * 1024))}MB.`)
  }

  let meta: sharp.Metadata
  try {
    meta = await sharp(input, { animated: true }).metadata()
  } catch {
    // The signature said it was an image and the decoder disagrees. Trust the decoder.
    throw new MediaError('That image could not be read.')
  }

  const width = meta.width ?? null
  // With `animated`, sharp reports the full filmstrip height; pages gives the frame count.
  const pages = meta.pages ?? 1
  const height = meta.pageHeight ?? meta.height ?? null

  if ((width ?? 0) > MAX_DIMENSION || (height ?? 0) > MAX_DIMENSION) {
    throw new MediaError(`That image is larger than ${MAX_DIMENSION} pixels on a side.`)
  }
  if (!width || !height) throw new MediaError('That image has no readable dimensions.')

  /*
    Animation is a property of the FILE, not of the format.

    This used to ask only whether a GIF had more than one page, so an animated WebP was treated as a
    still and re-encoded — which silently flattened it to its first frame. `pages > 1` is the real
    question, asked of every format that can carry frames.
  */
  const animated = CAN_ANIMATE.has(mimeType) && pages > 1

  if (animated) {
    // Passed through as-is. Re-encoding is what would flatten the animation, and the file has already
    // been validated by the signature check, the size ceiling and a successful metadata decode.
    return { buffer: input, mimeType, extension: EXTENSIONS[mimeType], width, height, animated: true }
  }

  // Re-encode a still image. This is the EXIF strip: the pixels are decoded and written out fresh, so
  // location, device and timestamp tags are not carried across rather than being individually removed.
  // `rotate()` first applies the orientation tag before it is discarded, so a phone photo does not end
  // up sideways.
  try {
    const pipeline = sharp(input).rotate()
    const out = mimeType === 'image/png'
      ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
      : mimeType === 'image/webp'
        ? await pipeline.webp({ quality: 88 }).toBuffer()
        : mimeType === 'image/avif'
          ? await pipeline.avif({ quality: 60 }).toBuffer()
          : await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer()

    // A single-frame GIF is stored as a GIF so the reference and extension stay consistent.
    if (mimeType === 'image/gif') {
      const gif = await sharp(input).gif().toBuffer()
      return { buffer: gif, mimeType, extension: 'gif', width, height, animated: false }
    }

    return { buffer: out, mimeType, extension: EXTENSIONS[mimeType], width, height, animated: false }
  } catch {
    throw new MediaError('That image could not be processed.')
  }
}
