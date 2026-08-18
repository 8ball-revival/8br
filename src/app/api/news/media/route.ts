import { NextResponse, type NextRequest } from 'next/server'

import { currentEditorialActor } from '@/lib/editorial/permissions'
import { storePastedMedia } from '@/lib/media/service'
import { MediaError, MAX_GIF_BYTES } from '@/lib/media/validate'

/**
 * Upload an image pasted into an article.
 *
 * Authorised on the editorial actor, which is the same rule that decides who may write an article: any
 * signed-in account with a usable profile. An account that is inactive, banned, timed out or
 * management-only is not an actor and cannot upload — that check lives in one place and this route
 * simply asks it.
 *
 * The body is read as multipart form data, so the bytes arrive as a file rather than as a base64 string
 * inside JSON. Nothing here fetches a URL on the client's behalf: the only way in is an actual
 * uploaded blob, which is what keeps this from becoming a way to make the server request arbitrary
 * addresses.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request: NextRequest) {
  const actor = await currentEditorialActor()
  if (!actor) {
    // 401 rather than 404: the editor is a signed-in surface, so the client already knows it exists
    // and telling it plainly lets the paste show a useful message.
    return NextResponse.json({ error: 'Sign in with an active account to upload an image.' }, { status: 401 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'That upload could not be read.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No image was attached.' }, { status: 400 })
  }
  // A cheap gate before anything is read into memory. The real ceiling is enforced on the bytes.
  if (file.size > MAX_GIF_BYTES) {
    return NextResponse.json({ error: 'That image is too large.' }, { status: 413 })
  }

  const altRaw = form.get('alt')
  const alt = typeof altRaw === 'string' ? altRaw : null

  try {
    const stored = await storePastedMedia({
      bytes: Buffer.from(await file.arrayBuffer()),
      // The client's filename is a hint only: the stored name is rebuilt from the sniffed type.
      filename: file.name,
      alt,
      uploaderPlayerId: actor.playerId,
    })
    return NextResponse.json(stored)
  } catch (err) {
    if (err instanceof MediaError) {
      // Expected refusals — wrong format, too big, rate limited. The message is safe to show.
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    console.error('[media] upload failed', err)
    return NextResponse.json({ error: 'That image could not be uploaded.' }, { status: 500 })
  }
}
