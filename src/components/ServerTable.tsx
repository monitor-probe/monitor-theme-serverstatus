import { lazy, Suspense, useState, type CSSProperties, type ReactNode } from "react"
import {
  siAlmalinux, siAlpinelinux, siArchlinux, siCentos, siDebian, siFedora, siLinux, siOpensuse, siRedhat,
  siRockylinux, siUbuntu, type SimpleIcon,
} from "simple-icons"

import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { groupsOf, type Node } from "@/lib/api"
import {
  bytes, compact, CYCLES, distro, duration, expiresIn, FOREVER, money, monthUsage, osName, cpuName, pair,
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
        node.online ? "bg-(image:--dot-online)" : deployed(node) ? "bg-(image:--dot-offline)" : "bg-muted-foreground/40",
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
function Bar({ pct, label }: { pct: number | null; label?: string }) {
  const v = pct === null ? 0 : Math.min(100, Math.max(0, pct))
  const tone = v >= 90 ? "bg-(image:--bar-danger)" : v >= 80 ? "bg-(image:--bar-warn)" : "bg-(image:--bar-ok)"
  return (
    <div className="relative h-5 overflow-hidden rounded bg-bar-track shadow-[inset_0_1px_2px_rgb(0_0_0/0.1)] @max-3xl:h-4">
      <div className={cn("h-full rounded-l-[3px] transition-[width] duration-500", tone)} style={{ width: `${v}%` }} />
      <span className="tnum absolute inset-y-0 left-1.5 flex items-center text-[10px] leading-none text-bar-text @max-3xl:left-0.5 @max-3xl:text-[8px]">
        {label ?? (pct === null ? "—" : `${v.toFixed(1)}%`)}
      </span>
    </div>
  )
}

// The widest form each formatter writes, in `ch`, measured with tabular figures.
// M is the widest unit letter, so each is measured in megabytes rather than the
// gigabytes a reading is more often in: `compact` spans "0B" to "1023M", that is
// 2.2 to 5.49; `bytes` reaches 7.19 at "1023 MB"; `rate` 10.09 at "1023.0 MB/s".
// Rounded up, since other UI fonts are a few percent wider than the one these
// were measured in.
const SLOT = { compact: 5.6, bytes: 7.3, rate: 10.2 }

/**
 * A figure that changes on every push, held in a slot wide enough for the widest
 * form it can take, so a node moving from 19K/s to 8.19K/s leaves the rest of the
 * line where it was. Right-aligned, so the unit keeps its place and the digits
 * grow towards the arrow instead.
 *
 * `ch` is the width of a digit under the tabular figures this selects, so a slot
 * follows whatever size it is drawn at, down to the 10px the table uses on a
 * phone. The width travels as a custom property rather than `min-width` itself,
 * which is what allows a caller to drop the reservation where the column is too
 * narrow to hold it: an inline style would outrank the class that does so.
 */
function Num({ ch, className, children }: { ch: number; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn("tnum inline-block min-w-(--slot) text-right", className)}
      style={{ "--slot": `${ch}ch` } as CSSProperties}
    >
      {children}
    </span>
  )
}

function Expiry({ node }: { node: Node }) {
  const days = expiresIn(node)
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
  status: "w-14 @max-3xl:w-[6%]",
  name: "max-w-60 min-w-32 truncate @max-3xl:w-[14%] @max-3xl:max-w-none @max-3xl:min-w-0 @max-sm:w-[17%]",
  location: "w-20 @max-3xl:w-[7%] @max-sm:hidden",
  os: "min-w-24 @max-6xl:hidden",
  uptime: "min-w-18 @max-3xl:hidden",
  expiry: "min-w-18 @max-6xl:hidden",
  load: "w-16 @max-3xl:hidden",
  speed: "min-w-30 @max-3xl:w-[21%] @max-3xl:min-w-0",
  bar: "w-[7.5%] min-w-22 @max-3xl:w-[10%] @max-3xl:min-w-0 @max-sm:w-[11%]",
  traffic: "w-[7.5%] min-w-22 @max-3xl:w-[22%] @max-3xl:min-w-0 @max-sm:w-[23%]",
}

/** One fact per line, the label in a fixed column so the values align. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[5.5em_minmax(0,1fr)] gap-x-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="tnum break-words">{children}</span>
    </div>
  )
}

function Details({ node }: { node: Node }) {
  if (!deployed(node)) {
    return <p className="px-4 py-3 text-muted-foreground">尚未接入。在后台生成安装命令并执行一次。</p>
  }
  const m = node.online ? node.metrics : null
  const usage = (used: number, total: number) => `${pair(used, total)}（${percent(used, total).toFixed(1)}%）`
  const flow = (rx: number, tx: number) => `↓ ${bytes(rx)} · ↑ ${bytes(tx)}`
  const away = node.last_seen ? Date.now() / 1000 - node.last_seen : 0
  const days = expiresIn(node)

  return (
    <div className="space-y-3 px-4 pt-2 pb-3 text-[13px] leading-6 @max-3xl:px-2 @max-3xl:text-xs @max-3xl:leading-5">
      {/* Three across, one topic a row: the machine, what it holds, what it is
          doing, what it has moved, and its term. Low enough that the chart
          beneath stays in view when a row opens. */}
      <div className="grid gap-x-8 @2xl:grid-cols-2 @5xl:grid-cols-3">
        <Line label="系统">
          <span className="inline-flex items-center gap-1.5 align-middle">
            <OsIcon os={node.os} />
            {[osName(node.os), node.kernel].filter(Boolean).join(" · ") || "—"}
          </span>
        </Line>
        <Line label="架构">
          {[node.arch, node.virt !== "none" && node.virt, node.agent_version && `agent ${node.agent_version}`]
            .filter(Boolean)
            .join(" · ") || "—"}
        </Line>
        <Line label="CPU">
          {node.cpu_name ? `${cpuName(node.cpu_name)} × ${node.cpu_cores}` : `${node.cpu_cores} 核`}
          {m && `（${m.cpu.toFixed(1)}%）`}
        </Line>

        <Line label="内存">{m ? usage(m.mem_used, m.mem_total) : bytes(node.mem_total)}</Line>
        <Line label="交换">
          {node.swap_total > 0 ? (m ? usage(m.swap_used, m.swap_total) : bytes(node.swap_total)) : "未启用"}
        </Line>
        <Line label="硬盘">{m ? usage(m.disk_used, m.disk_total) : bytes(node.disk_total)}</Line>

        <Line label="负载">{m ? m.load.map((n) => n.toFixed(2)).join(" / ") : "—"}</Line>
        <Line label="进程 / 连接">{m ? `${m.procs} · TCP ${m.tcp} · UDP ${m.udp}` : "—"}</Line>
        <Line label="网速">
          {m ? (
            <>
              ↓ <Num ch={SLOT.rate}>{rate(m.net_rx)}</Num> · ↑ <Num ch={SLOT.rate}>{rate(m.net_tx)}</Num>
            </>
          ) : (
            "—"
          )}
        </Line>

        <Line label="今日流量">{flow(node.day_rx, node.day_tx)}</Line>
        <Line label="本月流量">{flow(node.month_rx, node.month_tx)}</Line>
        <Line label="总流量">{flow(node.total_rx, node.total_tx)}</Line>

        <Line label={node.online ? "在线" : "离线"}>
          {node.online ? (m ? uptime(m.uptime) : "等待上报") : away >= 60 ? uptime(away) : "刚刚"}
        </Line>
        <Line label="续费">
          {node.price > 0 ? `${money(node.price, node.currency)} / ${CYCLES[node.billing_cycle] ?? node.billing_cycle}` : "免费"}
        </Line>
        <Line label="到期">
          {node.expires_at
            ? `${node.expires_at}（${days !== null && days < 0 ? `已过期 ${-days} 天` : `剩余 ${days} 天`}）`
            : "长期有效"}
        </Line>

        {node.traffic_reset_day > 0 && (
          <Line label="流量重置">每月 {node.traffic_reset_day} 日重置</Line>
        )}
      </div>

      <div className="space-y-2 border-t pt-3">
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
    </div>
  )
}

function Row({ node, index }: { node: Node; index: number }) {
  const [open, setOpen] = useState(false)
  const m = node.online ? node.metrics : null
  const traffic = monthUsage(node)
  // Parity from the node rather than :nth-child, so an opened detail row takes its
  // node's shade instead of shifting every row beneath it.
  const shade = index % 2 ? "bg-muted" : ""
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
        {/* No reservation on a phone: the column is 21% of the panel, 60px at
            320px, against the 70px two slots and their separator need, and the
            overflow disappears under the bar beside it. */}
        <TableCell className={COL.speed}>
          {m ? (
            <>
              <Num ch={SLOT.compact} className="@max-3xl:min-w-0">{compact(m.net_rx)}</Num> |{" "}
              <Num ch={SLOT.compact} className="@max-3xl:min-w-0">{compact(m.net_tx)}</Num>
            </>
          ) : (
            "— | —"
          )}
        </TableCell>
        <TableCell className={COL.bar}><Bar pct={m ? m.cpu : null} /></TableCell>
        <TableCell className={COL.bar}><Bar pct={m ? percent(m.mem_used, m.mem_total) : null} /></TableCell>
        <TableCell className={COL.bar}><Bar pct={m ? percent(m.disk_used, m.disk_total) : null} /></TableCell>
        <TableCell
          className={COL.traffic}
          title={`本月已用 ${node.traffic_limit > 0 ? `${pair(traffic, node.traffic_limit)}（${((traffic / node.traffic_limit) * 100).toFixed(1)}%）` : `${bytes(traffic)} · 无流量配额`}`}
        >
          <Bar
            pct={node.traffic_limit > 0 ? percent(traffic, node.traffic_limit) : null}
            label={`${compact(traffic)} / ${node.traffic_limit > 0 ? compact(node.traffic_limit) : FOREVER}`}
          />
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className={cn("border-0 hover:bg-transparent", shade)}>
          <TableCell colSpan={12} className="border-t-0! p-0! text-left whitespace-normal">
            <Details node={node} />
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

/**
 * One card per group, each with its own header and summary, in the order the
 * operator's node order gives the groups; the ungrouped come last. A hub without
 * groups -- or one predating them -- keeps the single table it always had.
 */
export function ServerTables({ nodes }: { nodes: Node[] }) {
  const groups = groupsOf(nodes)
  if (groups.length === 0) return <ServerTable title="服务器" nodes={nodes} />
  const ungrouped = nodes.filter((n) => !n.group)
  return (
    <>
      {/* Group names are free text, so the keys carry a prefix the ungrouped
          card's cannot share. */}
      {groups.map((g) => <ServerTable key={`=${g}`} title={g} nodes={nodes.filter((n) => n.group === g)} />)}
      {ungrouped.length > 0 && <ServerTable key="*" title="未分组" nodes={ungrouped} />}
    </>
  )
}

function ServerTable({ title, nodes }: { title: string; nodes: Node[] }) {
  const online = nodes.filter((n) => n.online && n.metrics)
  const sum = (pick: (n: Node) => number) => online.reduce((total, n) => total + pick(n), 0)
  const totalRx = nodes.reduce((total, n) => total + n.total_rx, 0)
  const totalTx = nodes.reduce((total, n) => total + n.total_tx, 0)
  const heads: [keyof typeof COL, ReactNode][] = [
    ["status", "状态"], ["name", "名称"], ["location", "位置"], ["os", "系统"], ["uptime", "在线"],
    ["expiry", "到期"], ["load", "负载"], ["speed", "网速 ↓|↑"],
    ["bar", "CPU"], ["bar", "内存"], ["bar", "硬盘"], ["traffic", "流量"],
  ]

  return (
    <section className="@container rounded-md border bg-card p-5 text-card-foreground shadow-sm max-md:p-2">
      <div className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-x-3 gap-y-1 px-1 pb-3 max-md:pb-2 @max-3xl:grid-cols-1">
        <h2 className="min-w-0 truncate text-lg font-semibold max-md:text-sm" title={title}>{title}</h2>
        <div className="tnum flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground max-md:text-[10px]">
          <span className="whitespace-nowrap">
            {/* The online count is reserved for as many digits as the total has,
                since it cannot exceed it. */}
            在线 <Num ch={String(nodes.length).length}>{nodes.filter((n) => n.online).length}</Num> / {nodes.length} · ↓{" "}
            <Num ch={SLOT.compact}>{compact(sum((n) => n.metrics!.net_rx))}</Num>/s · ↑{" "}
            <Num ch={SLOT.compact}>{compact(sum((n) => n.metrics!.net_tx))}</Num>/s
          </span>
          <span className="whitespace-nowrap" title="所列节点累计下载与上传流量">
            总流量 ↓ <Num ch={SLOT.bytes}>{bytes(totalRx)}</Num> · ↑ <Num ch={SLOT.bytes}>{bytes(totalTx)}</Num>
          </span>
        </div>
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
