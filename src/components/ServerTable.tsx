import { lazy, Suspense, useState, type ReactNode } from "react"

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

// From the chart page's chunk, which App warms at start, so the table itself
// carries no recharts.
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

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 break-words">
      <span className="text-muted-foreground">{label}：</span>
      {children}
    </div>
  )
}

function Details({ node }: { node: Node }) {
  if (!deployed(node)) {
    return <p className="text-muted-foreground">尚未接入。在后台生成安装命令并执行一次。</p>
  }
  const m = node.online ? node.metrics : null
  const usage = (used: number, total: number) => `${pair(used, total)}（${percent(used, total).toFixed(1)}%）`
  const flow = (rx: number, tx: number) => `↓ ${bytes(rx)} · ↑ ${bytes(tx)}`
  const away = node.last_seen ? Date.now() / 1000 - node.last_seen : 0
  const virt = node.virt && node.virt !== "none" ? `${node.virt}:` : ""

  return (
    <>
      <div className="grid gap-x-10 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
        <Line label="系统">
          {[osName(node.os), node.kernel].filter(Boolean).join(" · ")} [{virt}{node.arch || "—"}]
        </Line>
        <Line label="CPU">
          {node.cpu_name ? `${cpuName(node.cpu_name)} × ${node.cpu_cores}` : `${node.cpu_cores} 核`}
          {m && `（${m.cpu.toFixed(1)}%）`}
        </Line>
        <Line label="负载">{m ? m.load.map((n) => n.toFixed(2)).join(" / ") : "—"}</Line>
        <Line label="内存">{m ? usage(m.mem_used, m.mem_total) : bytes(node.mem_total)}</Line>
        <Line label="交换">
          {node.swap_total > 0 ? (m ? usage(m.swap_used, m.swap_total) : bytes(node.swap_total)) : "未启用"}
        </Line>
        <Line label="硬盘">{m ? usage(m.disk_used, m.disk_total) : bytes(node.disk_total)}</Line>
        <Line label="网速">{m ? `↓ ${rate(m.net_rx)} · ↑ ${rate(m.net_tx)}` : "—"}</Line>
        <Line label="进程 / 连接">{m ? `${m.procs} · TCP ${m.tcp} · UDP ${m.udp}` : "—"}</Line>
        <Line label={node.online ? "在线" : "离线"}>
          {node.online ? (m ? uptime(m.uptime) : "等待上报") : away >= 60 ? uptime(away) : "刚刚"}
        </Line>
        <Line label="今日流量">{flow(node.day_rx, node.day_tx)}</Line>
        <Line label="本月流量">{flow(node.month_rx, node.month_tx)}</Line>
        <Line label="总流量">{flow(node.total_rx, node.total_tx)}</Line>
        {node.traffic_limit > 0 && (
          <Line label="流量配额">
            {usage(monthUsage(node), node.traffic_limit)} · {MODES[node.traffic_mode] ?? node.traffic_mode}
            {node.traffic_reset_day > 0 && ` · 每月 ${node.traffic_reset_day} 日重置`}
          </Line>
        )}
        <Line label="续费">
          {node.price > 0 ? `${money(node.price, node.currency)} / ${CYCLES[node.billing_cycle] ?? node.billing_cycle}` : "免费"}
          {" · "}
          {node.expires_at ? `${node.expires_at} 到期` : "长期有效"}
        </Line>
        {node.agent_version && <Line label="agent">{node.agent_version}</Line>}
      </div>
      {/* The last day only, fetched when the row opens: the range and the
          resource charts are one click away on the chart page. */}
      <div className="mt-3">
        <Suspense fallback={<Skeleton className="h-[280px] @max-3xl:h-[220px]" />}>
          <Latency id={node.id} hours={24} className="h-[280px] @max-3xl:h-[220px]" />
        </Suspense>
      </div>
      <Link href={`/node/${node.id}`} className="mt-1.5 inline-block text-primary hover:underline">
        查看监控图表 →
      </Link>
    </>
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
        <TableCell className={COL.os}>{distro(node.os) || "—"}</TableCell>
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
          <TableCell colSpan={12} className="border-t-0! px-4 pt-1 pb-3 text-left text-[13px] leading-5 whitespace-normal @max-3xl:px-2 @max-3xl:text-[11px]">
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
          <TableRow className="border-0 hover:bg-transparent">
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
