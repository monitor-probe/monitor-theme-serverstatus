import { useEffect, useState, type ComponentProps } from "react"

const read = () => {
  const match = location.pathname.match(/^\/node\/(\d+)/)
  return match ? Number(match[1]) : null
}

/**
 * The node `/node/{id}` names, or null on the list. The hub serves index.html for
 * any unknown path, so a reload or a shared link lands on the same page without a
 * server-side route.
 */
export function useNodeRoute() {
  const [id, setId] = useState(read)
  useEffect(() => {
    const sync = () => setId(read())
    addEventListener("popstate", sync)
    return () => removeEventListener("popstate", sync)
  }, [])
  return id
}

/** Announced as a popstate, so every `useNodeRoute` hears it the way it hears back. */
export function navigate(href: string) {
  history.pushState({}, "", href)
  dispatchEvent(new PopStateEvent("popstate"))
  scrollTo(0, 0)
}

/**
 * A real anchor, so a modified or middle click still opens a new tab; only a plain
 * click is kept in the page.
 */
export function Link({ href, onClick, ...props }: ComponentProps<"a"> & { href: string }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        navigate(href)
      }}
      {...props}
    />
  )
}
