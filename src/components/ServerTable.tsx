import { lazy, Suspense, useState, type CSSProperties, type ReactNode } from "react"
import {
  siAlmalinux, siAlpinelinux, siArchlinux, siCentos, siDebian, siFedora, siLinux, siOpensuse, siRedhat,
  siRockylinux, siUbuntu, type SimpleIcon,
} from "simple-icons"

import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { Node } from "@/lib/api"
import {
  bytes, compact, CYCLES, daysUntil, distro, duration, FOREVER, MODES, money, monthUsage, osName, cpuName, pair,
  percent, rate, uptime,
} from "@/lib/format"
import { Link } from "@/lib/route"
import { cn } from "@/lib/utils"

// Emitted as files and fetched on first use, so a page carries only the flags its
// nodes are in rather than all 271. vite.config.ts keeps the small ones from being
// inlined into the bundle as data URLs.
const FLAGS = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("/node_modules/flag-icons/flags/4x3/*.svg", {
      query: "?url",
      import: "default",
      eager: true,
    }),
  ).map(([path, url]) => [path.match(/([\w-]+)\.svg$/)![1], url]),
)

const Latency = lazy(() => import("@/components/NodeDetail").then((m) => ({ default: m.Latency })))

/** A node that has reported once knows its shape; one that never connected has nothing to show. */
export function deployed(node: Node) {
  return node.cpu_cores > 0 || node.mem_total > 0
}

export function Dot({ node, className }: { node: Node; className?: string }) {
  return (
    <span
      title={node.online ? "在线" : deployed(node) ? "离线" : "未接入"}
      className={cn(
        "inline-block size-3 shrink-0 rounded-full align-middle",
        node.online ? "bg-ok" : deployed(node) ? "bg-danger" : "bg-muted-foreground/40",
        className,
      )}
    />
  )
}

export function Flag({ code, className }: { code: string; className?: string }) {
  if (!code) return <span className="text-muted-foreground">—</span>
  const src = FLAGS[code.toLowerCase()]
  return (
    <span className={cn("inline-flex items-center justify-center gap-1", className)}>
      {src && <img src={src} alt="" className="h-3 w-4 shrink-0 rounded-[2px] object-cover ring-1 ring-foreground/10" />}
      <span className="@max-3xl:hidden">{code}</span>
    </span>
  )
}

// Matched against the whole release name, since "Red Hat Enterprise Linux" and
// "Raspbian GNU/Linux" do not lead with one word to key on. The distributions a
// VPS ships with; the rest take the penguin. Each logo costs 1-6 KB of entry
// bundle, the Raspberry Pi alone 12 KB, so the list stays at what hosts offer.
const DISTROS: [string, SimpleIcon][] = [
  ["debian", siDebian], ["raspbian", siDebian], ["ubuntu", siUbuntu], ["alpine", siAlpinelinux],
  ["centos", siCentos], ["rocky", siRockylinux], ["almalinux", siAlmalinux], ["red hat", siRedhat],
  ["fedora", siFedora], ["arch", siArchlinux], ["opensuse", siOpensuse],
]

/**
 * The distribution's logo in its brand colour. Mixed toward white on the dark
 * theme, where AlmaLinux's black and CentOS's navy would otherwise vanish.
 */
export function OsIcon({ os, className }: { os: string; className?: string }) {
  if (!os) return null
  const name = os.toLowerCase()
  const icon = DISTROS.find(([key]) => name.includes(key))?.[1] ?? siLinux
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      style={{ "--brand": `#${icon.hex}` } as CSSProperties}
      className={cn("size-3.5 shrink-0 fill-(--brand) dark:fill-[color-mix(in_oklab,var(--brand)_60%,white)]", className)}
    >
      <path d={icon.path} />
    </svg>
  )
}

/**
 * The label sits over both halves of the bar in the text colour, which is why the
 * fills are light in the light theme and dark in the dark one.
 */
function Bar({ pct }: { pct: number | null }) {
  const v = pct === null ? 0 : Math.min(100, Math.max(0, pct))
  const tone = v >= 90 ? "bg-bar-danger" : v >= 80 ? "bg-bar-warn" : "bg-bar-ok"
  return (
    <div className="relative h-5 overflow-hidden rounded-sm bg-bar-track shadow-[inset_0_1px_2px_rgb(0_0_0/0.06)] @max-3xl:h-4">
      <div className={cn("h-full transition-[width] duration-500", tone)} style={{ width: `${v}%` }} />
      <span className="tnum absolute inset-y-0 left-1.5 flex items-center text-[10px] leading-none @max-3xl:left-0.5 @max-3xl:text-[8px]">
        {pct === null ? "—" : `${v.toFixed(1)}%`}
      </span>
    </div>
  )
}

function Expiry({ node }: { node: Node }) {
  const days = daysUntil(node.expires_at)
  if (days === null) return <span className="text-muted-foreground" title="永不到期">{FOREVER}</span>
  if (days < 0) return <span className="text-danger">已过期</span>
  return <span className={cn(days <= 7 && "text-warn")}>{days} 天</span>
}

/**
 * Column widths and what folds away, applied to the header and every cell alike.
 * The panel is the container, so the table follows its own width rather than the
 * viewport's. Below 768px it switches to a fixed layout that fits a phone without
 * sideways scrolling, keeping the columns that change every push.
 */
const COL = {
  status: "w-14 @max-3xl:w-[8%]",
  name: "max-w-60 min-w-32 truncate @max-3xl:w-[23%] @max-3xl:max-w-none @max-3xl:min-w-0",
  location: "w-20 @max-3xl:w-[8%]",
  os: "min-w-24 @max-6xl:hidden",
  uptime: "min-w-18 @max-3xl:hidden",
  expiry: "min-w-18 @max-6xl:hidden",
  load: "w-16 @max-3xl:w-[9%]",
  speed: "min-w-30 @max-3xl:w-[19%] @max-3xl:min-w-0",
  traffic: "min-w-34 @max-3xl:hidden",
  bar: "w-[7.5%] min-w-22 @max-3xl:w-[11%] @max-3xl:min-w-0",
}

/** A label over its value, with an optional muted line under both. */
function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="min-w-0 break-words">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="tnum mt-0.5 text-sm font-medium @max-3xl:text-[13px]">{value}</div>
      {note && <div className="tnum mt-0.5 text-xs text-muted-foreground">{note}</div>}
    </div>
  )
}

function Details({ node }: { node: Node }) {
  const m = node.online ? node.metrics : null
  const share = (used: number, total: number) => `${percent(used, total).toFixed(1)}%`
  const flow = (rx: number, tx: number) => `↓ ${bytes(rx)}  ↑ ${bytes(tx)}`
  const away = node.last_seen ? Date.now() / 1000 - node.last_seen : 0
  const days = daysUntil(node.expires_at)

  return (
    <div className="my-1 space-y-5 rounded-lg border bg-background/70 p-4 @max-3xl:space-y-4 @max-3xl:p-3">
      {deployed(node) ? (
        // Four across, one topic a row: the machine, what it holds, what it has
        // moved, and what it costs. Two across on a phone.
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 @3xl:grid-cols-4">
          <Stat
            label="系统"
            value={
              <span className="inline-flex items-center gap-1.5">
                <OsIcon os={node.os} />
                {osName(node.os) || "—"}
              </span>
            }
            note={node.kernel}
          />
          <Stat
            label="架构"
            value={[node.arch, node.virt !== "none" && node.virt].filter(Boolean).join(" · ") || "—"}
            note={node.agent_version && `agent ${node.agent_version}`}
          />
          <Stat
            label="CPU"
            value={node.cpu_name ? `${cpuName(node.cpu_name)} × ${node.cpu_cores}` : `${node.cpu_cores} 核`}
            note={m && `${m.cpu.toFixed(1)}% · 负载 ${m.load.map((n) => n.toFixed(2)).join(" ")}`}
          />
          <Stat
            label={node.online ? "在线" : "离线"}
            value={node.online ? (m ? uptime(m.uptime) : "等待上报") : away >= 60 ? uptime(away) : "刚刚"}
            note={!node.online && node.last_seen ? `最后上报 ${new Date(node.last_seen * 1000).toLocaleString("zh-CN")}` : undefined}
          />

          <Stat label="内存" value={m ? pair(m.mem_used, m.mem_total) : bytes(node.mem_total)} note={m && share(m.mem_used, m.mem_total)} />
          <Stat
            label="交换"
            value={node.swap_total > 0 ? (m ? pair(m.swap_used, m.swap_total) : bytes(node.swap_total)) : "未启用"}
            note={m && node.swap_total > 0 ? share(m.swap_used, m.swap_total) : undefined}
          />
          <Stat label="硬盘" value={m ? pair(m.disk_used, m.disk_total) : bytes(node.disk_total)} note={m && share(m.disk_used, m.disk_total)} />
          <Stat label="进程" value={m ? m.procs : "—"} note={m && `TCP ${m.tcp} · UDP ${m.udp}`} />

          <Stat label="实时网速" value={m ? `↓ ${rate(m.net_rx)}  ↑ ${rate(m.net_tx)}` : "—"} />
          <Stat label="今日流量" value={flow(node.day_rx, node.day_tx)} />
          <Stat
            label="本月流量"
            value={flow(node.month_rx, node.month_tx)}
            note={
              node.traffic_limit > 0
                ? `配额 ${pair(monthUsage(node), node.traffic_limit)} · ${share(monthUsage(node), node.traffic_limit)} · ${MODES[node.traffic_mode] ?? node.traffic_mode}`
                : undefined
            }
          />
          <Stat label="总流量" value={flow(node.total_rx, node.total_tx)} />

          <Stat
            label="续费"
            value={node.price > 0 ? money(node.price, node.currency) : "免费"}
            note={node.price > 0 ? (CYCLES[node.billing_cycle] ?? node.billing_cycle) : undefined}
          />
          <Stat
            label="到期"
            value={node.expires_at ?? "长期有效"}
            note={days === null ? undefined : days < 0 ? `已过期 ${-days} 天` : `剩余 ${days} 天`}
          />
          {node.traffic_limit > 0 && node.traffic_reset_day > 0 && (
            <Stat label="流量重置" value={`每月 ${node.traffic_reset_day} 日`} />
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">尚未接入。在后台生成安装命令并执行一次。</p>
      )}

      {deployed(node) && (
        <div className="space-y-2 border-t pt-4">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-muted-foreground">网络延迟 · 最近 24 小时</span>
            <Link href={`/node/${node.id}`} className="text-primary hover:underline">查看资源图表 →</Link>
          </div>
          {/* Fetched when the row opens, from the chart page's chunk, which App
              warms at start, so the table itself carries no recharts. */}
          <Suspense fallback={<Skeleton className="h-[280px] @max-3xl:h-[220px]" />}>
            <Latency id={node.id} className="h-[280px] @max-3xl:h-[220px]" />
          </Suspense>
        </div>
      )}
    </div>
  )
}

function Row({ node, index }: { node: Node; index: number }) {
  const [open, setOpen] = useState(false)
  const m = node.online ? node.metrics : null
  // Parity from the node rather than :nth-child, so an opened detail row takes its
  // node's shade instead of shifting every row beneath it.
  const shade = index % 2 ? "bg-muted/50" : ""
  const toggle = () => setOpen((o) => !o)

  return (
    <>
      <TableRow
        aria-expanded={open}
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle())}
        className={cn("cursor-pointer border-0 hover:bg-accent", shade)}
      >
        <TableCell className={COL.status}><Dot node={node} className="mx-auto block @max-3xl:size-2.5" /></TableCell>
        <TableCell className={COL.name} title={node.name}>{node.name}</TableCell>
        <TableCell className={COL.location}><Flag code={node.country} /></TableCell>
        <TableCell className={COL.os}>
          <span className="inline-flex items-center justify-center gap-1.5">
            <OsIcon os={node.os} />
            {distro(node.os) || "—"}
          </span>
        </TableCell>
        <TableCell className={COL.uptime}>{m ? duration(m.uptime) : "—"}</TableCell>
        <TableCell className={COL.expiry}><Expiry node={node} /></TableCell>
        <TableCell className={COL.load}>{m ? m.load[0].toFixed(2) : "—"}</TableCell>
        <TableCell className={COL.speed}>{m ? `${compact(m.net_rx)} | ${compact(m.net_tx)}` : "— | —"}</TableCell>
        <TableCell className={COL.traffic}>{`${compact(node.month_rx)} | ${compact(node.month_tx)}`}</TableCell>
        <TableCell className={COL.bar}><Bar pct={m ? m.cpu : null} /></TableCell>
        <TableCell className={COL.bar}><Bar pct={m ? percent(m.mem_used, m.mem_total) : null} /></TableCell>
        <TableCell className={COL.bar}><Bar pct={m ? percent(m.disk_used, m.disk_total) : null} /></TableCell>
      </TableRow>
      {open && (
        <TableRow className={cn("border-0 hover:bg-transparent", shade)}>
          <TableCell colSpan={12} className="border-t-0! px-3 pt-0 pb-3 text-left whitespace-normal @max-3xl:px-1.5">
            <Details node={node} />
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

export function ServerTable({ nodes }: { nodes: Node[] }) {
  const online = nodes.filter((n) => n.online && n.metrics)
  const sum = (pick: (n: Node) => number) => online.reduce((total, n) => total + pick(n), 0)
  const heads: [keyof typeof COL, ReactNode][] = [
    ["status", "状态"], ["name", "名称"], ["location", "位置"], ["os", "系统"], ["uptime", "在线"],
    ["expiry", "到期"], ["load", "负载"], ["speed", "网速 ↓|↑"], ["traffic", "月流量 ↓|↑"],
    ["bar", "CPU"], ["bar", "内存"], ["bar", "硬盘"],
  ]

  return (
    <section className="@container rounded-md border bg-card p-5 text-card-foreground shadow-sm max-md:p-2">
      <div className="flex items-baseline justify-between gap-3 px-1 pb-3 max-md:pb-2">
        <h2 className="text-lg font-semibold max-md:text-sm">服务器</h2>
        <span className="tnum truncate text-xs text-muted-foreground max-md:text-[10px]">
          在线 {nodes.filter((n) => n.online).length} / {nodes.length} · ↓ {compact(sum((n) => n.metrics!.net_rx))}/s · ↑{" "}
          {compact(sum((n) => n.metrics!.net_tx))}/s
        </span>
      </div>
      <Table className="text-center text-sm @max-3xl:table-fixed @max-3xl:text-[10px]">
        <TableHeader>
          <TableRow className="border-0 bg-secondary/60 hover:bg-secondary/60">
            {heads.map(([col, label], i) => (
              <TableHead key={i} className={cn("h-8 border-t px-1.5 text-center font-semibold @max-3xl:px-0.5", COL[col])}>
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        {/* Rules between rows rather than under them, as the header row starts. */}
        <TableBody className="[&_td]:h-[29px] [&_td]:border-t [&_td]:px-1.5 [&_td]:py-1 @max-3xl:[&_td]:px-0.5">
          {nodes.map((n, i) => (
            <Row key={n.id} node={n} index={i} />
          ))}
        </TableBody>
      </Table>
    </section>
  )
}
