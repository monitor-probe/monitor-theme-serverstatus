/// <reference types="node" />
import assert from "node:assert/strict"
import { api, groupsOf, safeNodes, type Node } from "./api.ts"

const node = { id: 1, metrics: { uptime: 100, cpu: 1, load: [0.1, 0.2, 0.3],
  mem_total: 1024, mem_used: 512, swap_total: 0, swap_used: 0, disk_total: 2048, disk_used: 1024,
  net_rx: 10, net_tx: 20, total_rx: 100, total_tx: 200, month_rx: 50, month_tx: 100,
  tcp: 3, udp: 4, procs: 20 } } as Node
assert.equal(safeNodes([node])[0], node)
for (const patch of [{ load: null }, { load: [1, "bad", 3] }, { cpu: "bad" }, { net_rx: Infinity }]) {
  const bad = { ...node, metrics: { ...node.metrics, ...patch } } as unknown as Node
  const result = safeNodes([bad, node])
  assert.equal(result[0].metrics, null)
  assert.equal(result[1], node)
}
console.log("invalid live reports are isolated")

// Tabs follow the node order; ungrouped nodes and a hub without the field add none.
assert.deepEqual(groupsOf([{ group: "东京" }, { group: "" }, {}, { group: "香港" }, { group: "东京" }]), ["东京", "香港"])
console.log("groups follow the node order")

// A timeout is retried, since the next attempt may take a live connection; a
// read cut off by it reads as a network failure, never as the browser's message.
{
  let calls = 0
  const timeout = () => new DOMException("signal timed out", "TimeoutError")
  globalThis.fetch = async () => {
    if (++calls < 3) throw timeout()
    return { ok: true, status: 200, json: async () => ({ nodes: [] }) } as unknown as Response
  }
  assert.deepEqual(await api("/nodes"), { nodes: [] })
  assert.equal(calls, 3)
  globalThis.fetch = async () => {
    throw timeout()
  }
  await assert.rejects(api("/nodes"), { status: 0, message: "网络连接失败，稍后再试" })
  globalThis.fetch = async () =>
    ({ ok: false, status: 503, headers: new Headers({ "content-type": "text/plain" }), text: async () => { throw new DOMException("aborted", "AbortError") } }) as unknown as Response
  await assert.rejects(api("/nodes"), { status: 0 })
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => JSON.parse("<html>") }) as unknown as Response
  await assert.rejects(api("/nodes"), { status: 200, message: "收到的不是状态数据，稍后再试" })
  console.log("timeouts are retried and read as network failures")
}
