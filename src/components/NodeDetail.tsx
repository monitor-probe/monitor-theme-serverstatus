import { useEffect, useMemo, useState } from "react"
import { median } from "d3-array"
import {
  Area, AreaChart, Brush, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts"

import { Skeleton } from "@/components/ui/skeleton"
import { deployed, Dot, Flag } from "@/components/ServerTable"
import { api, type Node } from "@/lib/api"
import {
  axisBytes, axisTop, bytes, clockFor, quarters, cpuName, CYCLES, FOREVER, money, osName, rate, timeTicks, uptime,
} from "@/lib/format"
import { cn } from "@/lib/utils"

type Point = {
  ts: number
  cpu: number
  mem_used: number
  disk_used: number
  net_rx: number
  net_tx: number
}
// `latency` is the bucket's median round trip, null when every probe in it timed
// out. `band` is the range its answers spanned, absent when they spanned nothing.
// `loss` is the percentage that timed out, absent when none did.
type PingPoint = {
  task_id: number
  ts: number
  latency: number | null
  band?: [number, number]
  loss?: number
}
/** Probe names by id, sent alongside the samples they label. */
type Probes = Record<string, string>
/**
 * Proportion of the whole window each probe lost, by id, absent for probes that
 * lost nothing. Sent because it cannot be derived here: every bucket's `loss` is
 * already a percentage of that bucket, so the sample counts it was divided by are
 * unavailable. Averaging them would weight a bucket holding one sample equally
 * with one holding twelve, and the window's first and last buckets are partial
 * regardless of what the probe does.
 */
type Loss = Record<string, number>

const RANGES = [
  { hours: 1, label: "1 小时" },
  { hours: 6, label: "6 小时" },
  { hours: 24, label: "24 小时" },
  { hours: 168, label: "7 天" },
]

// Latency stops at a day. A week-wide bucket would still carry the spread and the
// loss figure, but a week of probe history is outside this page's purpose, and
// these are the windows in which every ping remains on the chart.
const RANGES_FOR = { resources: RANGES, latency: RANGES.filter((r) => r.hours <= 24) }

const AXIS = { stroke: "currentColor", fontSize: 11, tickLine: false, axisLine: false }

// No grow-in animation: it would spend 1.5 s drawing a line across the panel on
// every range change, on a page meant to be read at a glance, and on the latency
// chart across seven hundred points per probe.
const SERIES = { dot: false as const, strokeWidth: 1.5, isAnimationActive: false }

// One width for every stacked panel's value axis. Sized to their own labels --
// 40px under "100%", 68px under "172 MB" -- the four plot areas would be offset by
// 28px, placing a CPU spike and the network spike that caused it at different x.
const Y_WIDTH = 68

// Hue alone separates the probes. A dash pattern would not: once every ping in a
// day is on the chart its period is shorter than the jitter, and dotted and dashed
// lines both read as texture.
const PALETTE = [1, 2, 3, 4, 5].map((i) => `var(--color-chart-${i})`)

// recharts paints its tooltip white unless told otherwise, which is a white box
// on the dark theme.
const TIP = {
  fontSize: 12,
  background: "var(--color-popover)",
  color: "var(--color-popover-foreground)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
}

const TABS = [
  { key: "resources", label: "资源" },
  { key: "latency", label: "网络延迟" },
] as const

function Panel({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-medium text-muted-foreground">{title}</h4>
      <div className="h-40 w-full text-muted-foreground">{children}</div>
    </div>
  )
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  )
}

/**
 * Hampel filter (Hampel 1974; MATLAB ships it as `hampel`). A point more than
 * `sigmas` robust deviations from its window's median is replaced by that median,
 * while everything else passes through unchanged, which is what distinguishes it
 * from a rolling median or a moving average.
 *
 * 1.4826 rescales the median absolute deviation to a standard deviation for
 * normally distributed data; 3 sigma is the conventional cut.
 */
function despike(points: PingPoint[], window = 7, sigmas = 3): PingPoint[] {
  const half = window >> 1
  // ponytail: recomputes the window per point. A few thousand samples is
  // negligible; substitute a rolling structure if a chart ever needs 100k.
  return points.map((p, i) => {
    // A timeout is a gap rather than a high reading: neither smoothed, nor counted
    // towards what its neighbours are compared against.
    if (p.latency === null) return p
    const near = points
      .slice(Math.max(0, i - half), i + half + 1)
      .map((x) => x.latency)
      .filter((v) => v !== null)
    const mid = median(near) ?? p.latency
    const mad = median(near.map((v) => Math.abs(v - mid))) ?? 0
    const outlier = mad > 0 && Math.abs(p.latency - mid) > sigmas * 1.4826 * mad
    return outlier ? { ...p, latency: mid } : p
  })
}

function Fact({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === "") return null
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{value}</dd>
    </div>
  )
}

type History = { metrics: Point[]; ping: PingPoint[]; probes: Probes; loss?: Loss }

/**
 * One window of history, or nothing while `series` is null.
 *
 * A refused request is kept apart from an empty window. The hub builds at most
 * four windows at once, since each holds the connection the agents report
 * through, and answers a fifth with a 503; drawn as an empty chart, that answer
 * would misdirect the reader, so callers show it with a retry.
 */
function useHistory(id: number, hours: number, series: "metrics" | "ping" | null) {
  const [data, setData] = useState<History | null>(null)
  const [failed, setFailed] = useState("")
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!series) return
    let active = true
    // The charts must not continue drawing the old window while the new one is in
    // flight.
    // oxlint-disable-next-line react/set-state-in-effect
    setData(null)
    // oxlint-disable-next-line react/set-state-in-effect
    setFailed("")
    // What this screen can resolve, in device pixels, which is the unit the line
    // is drawn in: a 1280-wide retina panel has 2560 of them for a day of minutes.
    // Read here rather than from a ref, since the hub only thins further, an
    // approximate figure suffices, and the viewport is known before layout. A
    // rotation keeps whatever it fetched with.
    //
    // Only the half on screen is requested; the other accounted for a third to two
    // thirds of every response and was never drawn.
    const points = Math.round(globalThis.innerWidth * (globalThis.devicePixelRatio || 1))
    api<History>(`/nodes/${id}/metrics?hours=${hours}&points=${points}&series=${series}`)
      .then((next) => { if (active) setData(next) })
      .catch((e: Error) => {
        // `|| "..."` as in App.tsx: HTTP/2 dropped statusText, so a bodiless
        // failure from a proxy arrives as the empty string and renders as no
        // error.
        if (active) { setFailed(e.message || "网络错误"); setData({ metrics: [], ping: [], probes: {} }) }
      })
    return () => { active = false }
  }, [id, hours, series, attempt])

  return { data, failed, retry: () => setAttempt((n) => n + 1) }
}

function Failed({ message, retry }: { message: string; retry: () => void }) {
  return (
    <p className="py-8 text-center text-sm text-destructive" role="alert">
      读取历史数据失败：{message}
      <button onClick={retry} className="ml-2 text-primary hover:underline">重试</button>
    </p>
  )
}

// A real time axis rather than the category axis recharts defaults to: on a
// category axis ticks are selected by index, so a period the agent was offline for
// collapses to nothing.
function timeAxis(rows: { ts: number }[], hours: number, from = 0, to = rows.length - 1) {
  return {
    dataKey: "ts",
    type: "number" as const,
    domain: ["dataMin", "dataMax"] as const,
    // Explicit, or recharts places them at 05:14 and 10:22. Any that still collide
    // are dropped by `minTickGap`.
    ticks: rows.length ? timeTicks(rows[from].ts, rows[to].ts) : undefined,
    tickFormatter: clockFor(hours),
    minTickGap: hours > 24 ? 72 : 40,
    ...AXIS,
  }
}

/**
 * Every probe's round trip to one node, as the chart page and the table's
 * expanded row both draw it: the legend above, sized to its chips, and the plot
 * with its brush below at the height `className` gives it.
 */
export function Latency({ id, hours, smooth = false, className }: {
  id: number; hours: number; smooth?: boolean; className?: string
}) {
  const { data, failed, retry } = useHistory(id, hours, "ping")
  // Probes switched off. Hiding a slow one is what makes the fast ones readable,
  // as the axis rescales to what remains.
  const [hiddenProbes, setHiddenProbes] = useState<number[]>([])
  // Where the brush has been dragged, so the axis reticks for the visible span.
  // Tagged with the window it was dragged on, so a new window starts unzoomed
  // without an effect to clear it.
  const [zoom, setZoom] = useState<{ of: History; range: [number, number] } | null>(null)

  // One series per probe that reported, labelled from the names the samples
  // arrived with. Memoised, as are the two below: the parent re-renders every few
  // seconds as live metrics arrive, and rebuilding the chart's data array on those
  // renders would reset the brush.
  const pingSeries = useMemo(
    () =>
      [...new Set((data?.ping ?? []).map((p) => p.task_id))]
        .map((id) => {
          // Timeouts are retained: dropping them would draw a probe losing half
          // its packets as an unbroken line, and one that never answered not at
          // all.
          const points = (data?.ping ?? []).filter((p) => p.task_id === id)
          // Taken from the hub rather than summed from the buckets above, each of
          // which is already a percentage of its own bucket, so averaging them
          // would report one lost round in thirteen as 50%.
          const loss = data?.loss?.[id] ?? 0
          return { id, name: data?.probes?.[id] ?? `探测 ${id}`, points, loss }
        })
        .filter((s) => s.points.length > 0),
    [data],
  )

  const shownProbes = useMemo(
    () => pingSeries.filter((s) => !hiddenProbes.includes(s.id)),
    [pingSeries, hiddenProbes],
  )
  // Keyed on the full list, so a line keeps its colour when others are hidden.
  const color = (id: number) => PALETTE[pingSeries.findIndex((p) => p.id === id) % PALETTE.length]

  // The hub stamps every sample with its bucket rather than the second the probe
  // finished, so probes reporting at the bucket's rate share rows instead of each
  // contributing its own: a day of four probes is 717 rows rather than 2,868. A
  // slower probe leaves gaps in its own column, which is what `connectNulls`
  // addresses.
  //
  // Every probe and both versions of every sample are held here whether or not
  // they are on screen: recharts resets the brush when the data array changes
  // identity, and re-reads a controlled selection only when the index props
  // change, which they do not. Hiding a probe or enabling despiking therefore
  // selects a `dataKey` rather than rebuilding the array.
  const pingRows = useMemo(() => {
    const rows = new Map<
      number,
      { ts: number } & Record<string, number | [number, number] | null>
    >()
    for (const s of pingSeries) {
      const smoothed = despike(s.points)
      s.points.forEach((p, i) => {
        const row = rows.get(p.ts) ?? { ts: p.ts * 1_000 }
        row[`t${s.id}`] = p.latency
        row[`s${s.id}`] = smoothed[i].latency
        row[`l${s.id}`] = p.loss ?? 0
        // Raw, never despiked: the band exists to show what the line omits, and
        // smoothing it would omit the same points. A bucket with a single answer
        // carries no band and spans only that answer. Left null, `connectNulls`
        // would bridge the hours between the few buckets that have one: 9 of
        // 1,438 in a day, the widest gap 268 minutes, drawn as one large wedge.
        row[`b${s.id}`] = p.band ?? (p.latency === null ? null : [p.latency, p.latency])
        rows.set(p.ts, row)
      })
    }
    return [...rows.values()].sort((a, b) => a.ts - b.ts)
  }, [pingSeries])

  if (!data) return <Skeleton className={cn("w-full", className)} />
  if (failed) return <Failed message={failed} retry={retry} />
  if (pingSeries.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">这段时间没有延迟数据</p>
  }
  const last = pingRows.length - 1
  const [from, to] = zoom?.of === data ? zoom.range.map((i) => Math.min(i, last)) : [0, last]

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {pingSeries.map((s) => {
          const shown = !hiddenProbes.includes(s.id)
          return (
            <button
              key={s.id}
              onClick={() =>
                setHiddenProbes((h) => (shown ? [...h, s.id] : h.filter((id) => id !== s.id)))
              }
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-opacity ${
                shown ? "" : "opacity-40"
              }`}
            >
              {/* The swatch carries the same colour as the line. */}
              <svg width="14" height="6" className="shrink-0" aria-hidden>
                <line x1="0" y1="3" x2="14" y2="3" stroke={color(s.id)} strokeWidth="2" />
              </svg>
              {s.name}
              {/* Always shown, since the line is only what answered and a probe
                  dropping half its packets draws like a healthy one. Anything
                  under a tenth is written as such rather than rounded to 0.0. */}
              <span className="tabular-nums opacity-60">
                {s.loss > 0 && s.loss < 0.1 ? "<0.1" : s.loss.toFixed(1)}%
              </span>
            </button>
          )
        })}
      </div>

      <div className={cn("w-full text-muted-foreground", className)}>
        {shownProbes.length === 0 ? (
          <p className="py-8 text-center text-sm">没有选中任何探测</p>
        ) : (
          <ResponsiveContainer>
            <ComposedChart data={pingRows}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis {...timeAxis(pingRows, hours, from, to)} />
              {/* Not anchored at zero: these lines live in a narrow band far from
                  it, and zero flattens every wobble. */}
              <YAxis unit="ms" width={52} domain={["auto", "auto"]} {...AXIS} />
              <Tooltip
                labelFormatter={(ts) => new Date(Number(ts)).toLocaleString("zh-CN")}
                // The line is drawn from what answered, so without this a bucket
                // that lost most of its packets reads as normal. `dataKey` is
                // `t7`/`s7`; the loss sits at `l7`.
                formatter={(v, name, item) => {
                  const loss = Number(item?.payload?.[`l${String(item.dataKey).slice(1)}`] ?? 0)
                  return [`${Number(v)} ms${loss > 0 ? ` · 丢 ${loss}%` : ""}`, name]
                }}
                contentStyle={TIP}
              />
              {/* Behind the line, the range that bucket's answers spanned --
                  Smokeping's "smoke". At the day window a bucket moves 63 ms at
                  the 90th percentile against the 25 ms the trend moves, so a line
                  alone draws the smaller of the two.

                  Only with one probe on screen: rendered for four, the bands
                  overlap into a fog and their extremes drag the axis from 165-385
                  out to 140-420. */}
              {shownProbes.length === 1 &&
                shownProbes.map((s) => (
                  <Area
                    key={`band${s.id}`}
                    dataKey={`b${s.id}`}
                    stroke="none"
                    fill={color(s.id)}
                    fillOpacity={0.16}
                    isAnimationActive={false}
                    tooltipType="none"
                    legendType="none"
                    connectNulls
                  />
                ))}
              {shownProbes.map((s) => (
                <Line
                  key={s.id}
                  dataKey={`${smooth ? "s" : "t"}${s.id}`}
                  name={s.name}
                  stroke={color(s.id)}
                  {...SERIES}
                  connectNulls
                />
              ))}
              {/* Drag either handle to zoom into a stretch of the trend. */}
              <Brush
                dataKey="ts"
                height={22}
                travellerWidth={8}
                tickFormatter={clockFor(hours)}
                // A prop rather than a class: recharts writes fill="#fff" onto the
                // rect itself, which a class cannot override.
                fill="var(--color-muted)"
                stroke="var(--color-muted-foreground)"
                onChange={(r) => setZoom({ of: data, range: [r.startIndex ?? 0, r.endIndex ?? last] })}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

export function NodeDetail({ node }: { node: Node }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("resources")
  // Each tab keeps its own range: a 7-day trend and a 1-hour trace answer
  // different questions.
  const [ranges, setRanges] = useState({ resources: 6, latency: 6 })
  const hours = ranges[tab]
  const [smooth, setSmooth] = useState(false)
  // The latency tab fetches for itself, inside `Latency`.
  const { data, failed, retry } = useHistory(node.id, ranges.resources, tab === "resources" ? "metrics" : null)

  const m = node.metrics
  const away = node.last_seen ? Date.now() / 1000 - node.last_seen : 0

  // The hub answers in seconds; the time axis requires milliseconds.
  const metricRows = useMemo(
    () => (data?.metrics ?? []).map((m) => ({ ...m, ts: m.ts * 1_000 })),
    [data],
  )

  // Axis tops for the two panels with no capacity to measure against. CPU and a
  // transfer rate do not express fullness: against a fixed 0-100, a machine
  // sitting at 0.4% draws as a line along the panel's floor. Memory and disk keep
  // their totals as tops, where fullness is the entire question.
  const tops = useMemo(() => {
    const max = (pick: (m: Point) => number) =>
      metricRows.reduce((hi, m) => Math.max(hi, pick(m)), 0)
    return {
      // A floor of 4%, or a machine that never exceeds 0.4% would get an axis of
      // 0-0.4 and render every scheduler blip as a peak. Capped at 100.
      cpu: axisTop(max((m) => m.cpu), 4, 10, 100),
      // Base 1024, so the steps are round in the unit `axisBytes` prints.
      rate: axisTop(max((m) => Math.max(m.net_rx, m.net_tx)), 1024, 1024),
    }
  }, [metricRows])

  return (
    <div className="space-y-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <Dot node={node} />
        <h2 className="truncate text-lg font-semibold">{node.name}</h2>
        <Flag code={node.country} className="text-sm" />
        <span className="tnum text-xs text-muted-foreground">
          {node.online ? `在线 ${m ? uptime(m.uptime) : ""}` : deployed(node) ? `离线 ${away >= 60 ? uptime(away) : ""}` : "未接入"}
        </span>
        {node.agent_version && <span className="text-xs text-muted-foreground">agent {node.agent_version}</span>}
      </div>

      {/* One flat row of facts: what is left after the traffic figures moved
          out is one machine's spec sheet, and a box around a single topic is
          just a box. Three across at lg, two at md, one on a phone -- a kernel
          version or a CPU model needs about 270px to stay whole. */}
      <dl className="grid gap-x-6 gap-y-3 md:grid-cols-2 lg:grid-cols-3">
        <Fact label="系统" value={[osName(node.os), node.kernel].filter(Boolean).join(" · ")} />
        <Fact
          label="CPU"
          value={node.cpu_name ? `${cpuName(node.cpu_name)} × ${node.cpu_cores}` : `${node.cpu_cores} 核`}
        />
        <Fact label="内存 / 硬盘" value={`${bytes(node.mem_total)} / ${bytes(node.disk_total)}`} />
        <Fact
          label="架构"
          value={[node.arch, node.virt !== "none" ? node.virt : "", m ? `${m.procs} 进程` : ""]
            .filter(Boolean)
            .join(" · ")}
        />
        <Fact label="今日流量" value={`↓ ${bytes(node.day_rx)} · ↑ ${bytes(node.day_tx)}`} />
        <Fact
          label="续费"
          value={[
            node.price > 0
              ? `${money(node.price, node.currency)} / ${CYCLES[node.billing_cycle] ?? node.billing_cycle}`
              : "免费",
            node.expires_at ? `${node.expires_at} 到期` : FOREVER,
          ].join(" · ")}
        />
      </dl>

      {node.remark && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{node.remark}</p>
      )}

      <div className="space-y-2 border-t pt-4">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <Tab key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}
            </Tab>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex gap-1">
            {RANGES_FOR[tab].map((r) => (
              <Tab
                key={r.hours}
                active={hours === r.hours}
                onClick={() => setRanges((all) => ({ ...all, [tab]: r.hours }))}
              >
                {r.label}
              </Tab>
            ))}
          </div>
          {tab === "latency" && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={smooth}
                onChange={(e) => setSmooth(e.target.checked)}
                className="accent-primary"
              />
              削峰
            </label>
          )}
        </div>
      </div>

      {tab === "latency" ? (
        <Latency id={node.id} hours={hours} smooth={smooth} className="h-[420px] max-md:h-[320px]" />
      ) : !data ? (
        <Skeleton className="h-40 w-full" />
      ) : failed ? (
        <Failed message={failed} retry={retry} />
      ) : data.metrics.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">这段时间没有历史数据</p>
      ) : (
        <div className="space-y-5">
          <Panel title="CPU">
            <ResponsiveContainer>
              <AreaChart data={metricRows}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis {...timeAxis(metricRows, hours)} />
                <YAxis domain={[0, tops.cpu]} ticks={quarters(tops.cpu)} unit="%" width={Y_WIDTH} {...AXIS} />
                <Tooltip
                  labelFormatter={(ts) => new Date(Number(ts)).toLocaleString("zh-CN")}
                  formatter={(v) => [`${Number(v).toFixed(1)}%`, "CPU"]}
                  contentStyle={TIP}
                />
                <Area dataKey="cpu" stroke="var(--color-chart-1)" fill="var(--color-chart-1)" fillOpacity={0.15} {...SERIES} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>

          {/* The axis top is the machine's memory, so the line's height is the
              fraction in use whatever range is picked. Tracking the window's
              own maximum, which is what an area chart does by default, puts
              127 MB of a 457 MB box at the top of the panel. The size is in the
              title because the axis top is claiming it. */}
          <Panel title={`内存 · ${bytes(node.mem_total)}`}>
            <ResponsiveContainer>
              <AreaChart data={metricRows}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis {...timeAxis(metricRows, hours)} />
                <YAxis domain={[0, node.mem_total]} ticks={quarters(node.mem_total)} tickFormatter={axisBytes} width={Y_WIDTH} {...AXIS} />
                <Tooltip
                  labelFormatter={(ts) => new Date(Number(ts)).toLocaleString("zh-CN")}
                  formatter={(v) => bytes(Number(v))}
                  contentStyle={TIP}
                />
                <Area dataKey="mem_used" name="内存" stroke="var(--color-chart-4)" fill="var(--color-chart-4)" fillOpacity={0.15} {...SERIES} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>

          {/* A rate has no total to be a fraction of, so this one climbs the
              ladder like CPU rather than pinning to a capacity. */}
          <Panel
            title={
              <>
                网络速率
                <span className="ml-3 text-chart-2">● 下行</span>
                <span className="ml-2 text-chart-3">● 上行</span>
              </>
            }
          >
            <ResponsiveContainer>
              <LineChart data={metricRows}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis {...timeAxis(metricRows, hours)} />
                <YAxis domain={[0, tops.rate]} ticks={quarters(tops.rate)} tickFormatter={axisBytes} unit="/s" width={Y_WIDTH} {...AXIS} />
                <Tooltip
                  labelFormatter={(ts) => new Date(Number(ts)).toLocaleString("zh-CN")}
                  formatter={(v) => rate(Number(v))}
                  contentStyle={TIP}
                />
                <Line dataKey="net_rx" name="下行" stroke="var(--color-chart-2)" {...SERIES} />
                <Line dataKey="net_tx" name="上行" stroke="var(--color-chart-3)" {...SERIES} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>

          {/* The disk it is filling, for the same reason as memory: a node
              using 2.7% of its disk draws along the top of the panel when the
              axis tracks the window's own maximum. */}
          <Panel title={`硬盘 · ${bytes(node.disk_total)}`}>
            <ResponsiveContainer>
              <AreaChart data={metricRows}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis {...timeAxis(metricRows, hours)} />
                <YAxis domain={[0, node.disk_total]} ticks={quarters(node.disk_total)} tickFormatter={axisBytes} width={Y_WIDTH} {...AXIS} />
                <Tooltip
                  labelFormatter={(ts) => new Date(Number(ts)).toLocaleString("zh-CN")}
                  formatter={(v) => bytes(Number(v))}
                  contentStyle={TIP}
                />
                <Area dataKey="disk_used" name="硬盘" stroke="var(--color-chart-5)" fill="var(--color-chart-5)" fillOpacity={0.15} {...SERIES} />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>
        </div>
      )}
    </div>
  )
}
