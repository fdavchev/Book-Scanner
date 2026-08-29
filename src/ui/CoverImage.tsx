import { useEffect, useMemo } from 'react'

/**
 * Renders a cover Blob straight from IndexedDB, revoking its object URL on unmount so a
 * long library list does not leak one per row.
 */
export function CoverImage({
  blob,
  alt,
  large = false,
}: {
  blob?: Blob
  alt: string
  large?: boolean
}) {
  const url = useMemo(
    () => (blob instanceof Blob ? URL.createObjectURL(blob) : undefined),
    [blob],
  )
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const className = large ? 'cover large' : 'cover'
  if (!url) return <div className={className} aria-hidden="true" />
  return <img className={className} src={url} alt={alt} />
}
