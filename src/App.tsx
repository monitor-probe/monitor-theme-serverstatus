import { lazy, Suspense, useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import { ArrowUp, ChartLine, House, Moon, Sun, UserRound, type LucideIcon } from "lucide-react"

import { NodePicker } from "@/components/NodePicker"
import { ServerTables } from "@/components/ServerTable"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { api, useNodes } from "@/lib/api"
import { Link, useNodeRoute } from "@/lib/route"

type Me = { authed: boolean; github: boolean; site_name: string; public_page: boolean }

// Split out because recharts is most of the bundle and the list draws no chart.
// Warmed as soon as the app starts, so the first chart opened does not wait on it.
const loadDetail = () => import("@/components/NodeDetail").then((m) => ({ default: m.NodeDetail }))
const NodeDetail = lazy(loadDetail)

const DARK_MEDIA = matchMedia("(prefers-color-scheme: dark)")

/**
 * The visitor's own choice, or the system's while there is none. Only the toggle
 * writes the choice down: persisting the system's answer on load would pin it,
 * leaving a visitor who never touched the toggle in whichever mode their system
 * happened to be in that day. The panel at `/admin/` shares this key on one
 * origin, so it has to hold to the same rule -- one app writing on load pins the
 * others.
 *
 * The system's answer is subscribed to rather than copied into state: a flip
 * landing between the first render and the effect that would have attached the
 * listener is otherwise never heard, and the next one is a day away.
 */
function useTheme() {
  const [saved, setSaved] = useState(() => localStorage.getItem("theme"))
  const system = useSyncExternalStore(
    (notify) => {
      DARK_MEDIA.addEventListener("change", notify)
      return () => DARK_MEDIA.removeEventListener("change", notify)
    },
    () => DARK_MEDIA.matches,
  )
  const dark = saved ? saved === "dark" : system

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
  }, [dark])

  return [
    dark,
    () => {
      const next = dark ? "light" : "dark"
      localStorage.setItem("theme", next)
      setSaved(next)
    },
  ] as const
}

/** Kept in the corner rather than the header, as the classic layout does. */
function Toolbox({ dark, toggle }: { dark: boolean; toggle: () => void }) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const sync = () => setScrolled(scrollY > 200)
    addEventListener("scroll", sync, { passive: true })
    return () => removeEventListener("scroll", sync)
  }, [])
  const style = "size-10 bg-card/85 text-primary shadow-md backdrop-blur hover:bg-card hover:text-primary max-md:size-9"
  return (
    <div className="fixed right-3 bottom-5 z-20 flex flex-col gap-2.5 max-md:bottom-3">
      {scrolled && (
        <Button variant="ghost" size="icon" className={style} title="回到顶部" onClick={() => scrollTo({ top: 0, behavior: "smooth" })}>
          <ArrowUp />
        </Button>
      )}
      <Button variant="ghost" size="icon" className={style} title="切换主题" onClick={toggle}>
        {dark ? <Sun /> : <Moon />}
      </Button>
    </div>
  )
}

function NavItem({ href, active, icon: Icon, children }: { href: string; active: boolean; icon: LucideIcon; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="inline-flex items-center gap-1.5 px-3.5 text-sm transition-colors hover:text-primary aria-[current=page]:text-primary max-sm:px-2.5"
    >
      <Icon className="size-3.5" />
      {children}
    </Link>
  )
}

export default function App() {
  const [dark, toggleTheme] = useTheme()
  const [me, setMe] = useState<Me | null>(null)
  const [meError, setMeError] = useState("")
  const { nodes, error, closed } = useNodes()
  const open = useNodeRoute()

  const loadMe = useCallback(() => {
    return api<Me>("/me")
      .then((next) => { setMe(next); setMeError("") })
      .catch((e: Error) => setMeError(e.message))
  }, [])

  useEffect(() => {
    loadMe()
    void loadDetail()
  }, [loadMe])

  // The status page was closed while this tab was open: re-query, so the effect
  // below sends an anonymous visitor to the panel instead of a list that stopped.
  useEffect(() => {
    if (closed) void loadMe()
  }, [closed, loadMe])

  useEffect(() => {
    if (me && !me.public_page && !me.authed) location.href = "/admin/"
  }, [me])

  const sorted = [...(nodes ?? [])].sort((a, b) => a.sort - b.sort || a.id - b.id)
  const selected = sorted.find((n) => n.id === open)
  const site = me?.site_name || "Monitor"

  useEffect(() => {
    document.title = [selected?.name, site].filter(Boolean).join(" · ")
  }, [selected?.name, site])

  if (!me) return (
    <div className="grid min-h-svh place-items-center p-6 text-sm text-muted-foreground">
      {meError ? <div className="space-y-3 text-center"><p role="alert">加载失败：{meError}</p><Button onClick={loadMe}>重试</Button></div> : "加载中…"}
    </div>
  )

  if (!me.public_page && !me.authed) return null

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b bg-nav shadow-[0_1px_10px_rgb(0_0_0/0.1)]">
        <div className="mx-auto flex h-12 w-[95vw] max-w-[1680px] items-stretch max-md:w-full max-md:px-2">
          <Link href="/" className="mr-5 flex min-w-0 items-center gap-2 text-lg max-sm:mr-1 max-sm:text-base">
            <img src="/favicon.svg" alt="" className="size-5 shrink-0" />
            <span className="truncate">{site}</span>
          </Link>
          <nav className="flex shrink-0 items-stretch">
            <NavItem href="/" active={open === null} icon={House}>首页</NavItem>
            {sorted.length > 0 && (
              <NavItem href={`/node/${open ?? sorted[0].id}`} active={open !== null} icon={ChartLine}>监控</NavItem>
            )}
          </nav>
          {/* The panel is a separate app built into the hub, so this is a
              navigation rather than a route. */}
          <a href="/admin/" className="ml-auto inline-flex shrink-0 items-center gap-1.5 px-3.5 text-sm transition-colors hover:text-primary max-sm:px-2">
            <UserRound className="size-3.5" />
            <span className="max-sm:sr-only">{me.authed ? "后台" : "登录"}</span>
          </a>
        </div>
      </header>

      <main className="mx-auto w-[95vw] max-w-[1680px] flex-1 space-y-4 py-5 max-md:w-full max-md:px-2 max-md:py-2.5">
        {error && (
          <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
            {error}
          </p>
        )}

        {!nodes ? (
          <Skeleton className="h-80" />
        ) : open === null ? (
          sorted.length === 0 ? (
            <p className="rounded-md border bg-card py-16 text-center text-sm text-muted-foreground shadow-sm">还没有节点</p>
          ) : (
            <ServerTables nodes={sorted} />
          )
        ) : selected ? (
          <div className="grid gap-5 rounded-md border bg-card p-5 text-card-foreground shadow-sm max-md:gap-3 max-md:p-2.5 md:grid-cols-[220px_minmax(0,1fr)]">
            <NodePicker nodes={sorted} selected={selected.id} />
            <div className="min-w-0">
              <Suspense fallback={<Skeleton className="h-96" />}>
                <NodeDetail node={selected} />
              </Suspense>
            </div>
          </div>
        ) : (
          <p className="rounded-md border bg-card py-16 text-center text-sm text-muted-foreground shadow-sm">
            节点不存在或未公开。<Link href="/" className="text-primary hover:underline">返回列表</Link>
          </p>
        )}
      </main>

      <footer className="pb-5 text-center text-xs text-muted-foreground max-md:pb-3">
        {site} | ServerStatus | Powered by{" "}
        <a href="https://github.com/monitor-probe/monitor" target="_blank" rel="noreferrer" className="hover:text-primary">
          monitor
        </a>
      </footer>

      <Toolbox dark={dark} toggle={toggleTheme} />
    </div>
  )
}
