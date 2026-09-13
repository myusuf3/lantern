import { isL3, type Network, type Route } from "@lantern/engine";
import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getStraightPath,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ArpRow, MacRow } from "./steps.js";

export interface HostData extends Record<string, unknown> {
  id: string;
  kind: "host" | "router";
  interfaces: { name: string; mac: string; ip: string }[];
  arp: ArpRow[] | undefined;
  routes: Route[] | undefined;
  activeRoute: { dst: string; via?: string | undefined; dev: string } | undefined;
  active: boolean;
}

export interface SwitchData extends Record<string, unknown> {
  id: string;
  ports: string[];
  macs: MacRow[];
  active: boolean;
}

export interface CableData extends Record<string, unknown> {
  id: string;
  /** A frame crossing this cable during the current step. */
  inFlight?: { label: string; reverse: boolean; key: string } | undefined;
  /** The metric a router at either end gives a route down this cable, when it gives one. */
  metric?: string | undefined;
}

type HostNode = Node<HostData, "host">;
type SwitchNode = Node<SwitchData, "switch">;
type CableEdge = Edge<CableData, "cable">;

function Ports() {
  return (
    <>
      <Handle type="source" position={Position.Right} className="port" />
      <Handle type="target" position={Position.Left} className="port" />
    </>
  );
}

function Empty({ cols }: { cols: number }) {
  return (
    <tr>
      <td className="empty" colSpan={cols}>
        empty
      </td>
    </tr>
  );
}

function HostBox({ data }: NodeProps<HostNode>) {
  const sameRoute = (r: Route) =>
    data.activeRoute !== undefined &&
    r.dst === data.activeRoute.dst &&
    r.dev === data.activeRoute.dev &&
    r.via === data.activeRoute.via;
  return (
    <div className={`box${data.active ? " box-active" : ""}`} data-testid={`node-${data.id}`}>
      <Ports />
      <div className="box-name">
        {data.id}
        {data.kind === "router" && <span className="box-kind">router</span>}
      </div>
      <table className="box-table">
        <tbody>
          {data.interfaces.flatMap((i) => [
            <tr key={`${i.name}-name`} className="iface-first">
              <th scope="row">interface</th>
              <td className="mono">{i.name}</td>
            </tr>,
            <tr key={`${i.name}-mac`}>
              <th scope="row">MAC</th>
              <td className="mono">{i.mac}</td>
            </tr>,
            <tr key={`${i.name}-ip`}>
              <th scope="row">IP</th>
              <td className="mono">{i.ip}</td>
            </tr>,
          ])}
        </tbody>
      </table>
      {data.routes && (
        <table className="box-table rows">
          <caption>routing table</caption>
          <thead>
            <tr>
              <th>destination</th>
              <th>via</th>
              <th>interface</th>
            </tr>
          </thead>
          <tbody>
            {data.routes.length === 0 && <Empty cols={3} />}
            {data.routes.map((r) => (
              <tr key={`${r.dst}|${r.via ?? ""}|${r.dev}`} className={sameRoute(r) ? "active" : ""}>
                <td className="mono">{r.dst}</td>
                <td className="mono">{r.via ?? "direct"}</td>
                <td className="mono">{r.dev}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.arp && (
        <table className="box-table rows">
          <caption>ARP table</caption>
          <thead>
            <tr>
              <th>IP</th>
              <th>MAC</th>
              <th>interface</th>
            </tr>
          </thead>
          <tbody>
            {data.arp.length === 0 && <Empty cols={3} />}
            {data.arp.map((row) => (
              <tr key={row.ip} className={row.fresh ? "fresh" : ""}>
                <td className="mono">{row.ip}</td>
                <td className="mono">{row.mac}</td>
                <td className="mono">{row.dev}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SwitchBox({ data }: NodeProps<SwitchNode>) {
  return (
    <div
      className={`box box-switch${data.active ? " box-active" : ""}`}
      data-testid={`node-${data.id}`}
    >
      <Ports />
      <div className="box-name">
        {data.id}
        <span className="box-kind">switch</span>
      </div>
      <table className="box-table">
        <tbody>
          <tr>
            <th scope="row">ports</th>
            <td className="mono">{data.ports.join("  ")}</td>
          </tr>
        </tbody>
      </table>
      <table className="box-table rows">
        <caption>MAC table</caption>
        <thead>
          <tr>
            <th>MAC</th>
            <th>port</th>
          </tr>
        </thead>
        <tbody>
          {data.macs.length === 0 && <Empty cols={2} />}
          {data.macs.map((row) => (
            <tr key={row.mac} className={row.fresh ? "fresh" : ""}>
              <td className="mono">{row.mac}</td>
              <td className="mono">{row.port}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cable({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<CableEdge>) {
  const [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const flight = data?.inFlight;
  const motionPath = flight?.reverse
    ? getStraightPath({ sourceX: targetX, sourceY: targetY, targetX: sourceX, targetY: sourceY })[0]
    : path;
  return (
    <>
      <BaseEdge id={id} path={path} className="cable" />
      {flight && (
        <g className="token" key={flight.key}>
          <circle r="7" />
          <animateMotion
            dur="1.1s"
            fill="freeze"
            path={motionPath}
            calcMode="spline"
            keySplines="0.4 0 0.2 1"
            keyTimes="0;1"
          />
        </g>
      )}
      {(flight || data?.metric) && (
        <EdgeLabelRenderer>
          {flight && (
            <div
              className="cable-label"
              style={{
                transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 24}px)`,
              }}
            >
              {flight.label}
            </div>
          )}
          {data?.metric && (
            <div
              className="cable-metric"
              style={{
                transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + 22}px)`,
              }}
            >
              metric {data.metric}
            </div>
          )}
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { host: HostBox, switch: SwitchBox };
const edgeTypes = { cable: Cable };

export interface Flight {
  link: string;
  from: string;
  label: string;
  key: string;
}

export interface SceneProps {
  network: Network;
  show: { arp: boolean; routes: boolean };
  arpTables: Record<string, ArpRow[]>;
  macTables: Record<string, MacRow[]>;
  activeNodes: string[];
  activeRoute: HostData["activeRoute"];
  inFlight: Flight[];
}

/**
 * Boxes are 300px wide. A short network gets a long cable so a frame's crossing is visible; a
 * long chain gets a tighter one so five boxes still fit the screen legibly.
 */
const COLUMN = 640;
const COLUMN_TIGHT = 470;
const TIGHT_FROM = 5;
const ROW = 420;
const ROW_GAP = 90;
const BASE_HEIGHT = 520;
const ROW_HEIGHT = 300;

/**
 * Columns follow hops from the first node; a node not on the way to the last node drops to a
 * lower row in its column, so a switch's extra machines hang below the path instead of extending it.
 */
function layout(network: Network): Map<string, { x: number; row: number }> {
  const column = network.nodes.length >= TIGHT_FROM ? COLUMN_TIGHT : COLUMN;
  const adjacent = new Map<string, string[]>();
  for (const l of network.links) {
    const [a = ""] = l.a.split("/");
    const [b = ""] = l.b.split("/");
    adjacent.set(a, [...(adjacent.get(a) ?? []), b]);
    adjacent.set(b, [...(adjacent.get(b) ?? []), a]);
  }
  const first = network.nodes[0]?.id ?? "";
  const columnOf = new Map<string, number>([[first, 0]]);
  const parent = new Map<string, string>();
  for (const queue = [first]; queue.length > 0; ) {
    const n = queue.shift() ?? "";
    for (const m of adjacent.get(n) ?? []) {
      if (columnOf.has(m)) continue;
      columnOf.set(m, (columnOf.get(n) ?? 0) + 1);
      parent.set(m, n);
      queue.push(m);
    }
  }
  const last = network.nodes[network.nodes.length - 1]?.id ?? "";
  const onPath = new Set<string>();
  for (let n: string | undefined = last; n !== undefined; n = parent.get(n)) onPath.add(n);

  const rowsUsed = new Map<number, number>();
  const positions = new Map<string, { x: number; row: number }>();
  for (const n of network.nodes) {
    const col = columnOf.get(n.id) ?? 0;
    const row = onPath.has(n.id) ? 0 : (rowsUsed.get(col) ?? 0) + 1;
    if (!onPath.has(n.id)) rowsUsed.set(col, row);
    positions.set(n.id, { x: col * column, row });
  }
  return positions;
}

/**
 * The metrics routers give their routes, by the cable each route leads down. A metric only means
 * something next to the alternative it beats, so it is drawn on the cable, not in the table.
 */
function metricsByLink(network: Network): Map<string, string> {
  const metrics = new Map<string, Set<number>>();
  for (const n of network.nodes.filter(isL3)) {
    for (const r of n.routes.filter((r) => r.metric > 0)) {
      const link = n.interfaces.find((i) => i.name === r.dev)?.link;
      if (link !== undefined) metrics.set(link, new Set(metrics.get(link)).add(r.metric));
    }
  }
  return new Map(
    [...metrics].map(([link, set]) => [link, [...set].sort((a, b) => a - b).join(" / ")]),
  );
}

function sameYs(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/** How many rows the layout uses, so the scene can be tall enough to show them. */
function rowCount(positions: Map<string, { x: number; row: number }>): number {
  return 1 + Math.max(0, ...[...positions.values()].map((p) => p.row));
}

/**
 * Rows stack by measured height: a box in a lower row sits below every box above it in the same
 * column, with a gap. Re-stacks whenever a box grows, e.g. when an ARP table gains a row, then
 * fits the view; the view also refits when the window changes.
 */
function StackRows({
  slots,
  onStacked,
}: {
  slots: Map<string, { x: number; row: number }>;
  onStacked: (ys: Record<string, number>) => void;
}) {
  const { fitView } = useReactFlow();
  // Measured sizes live on React Flow's internal nodes, not on the nodes this scene passes in.
  // A string, so the effect below re-runs only when a measured height actually changes.
  const heights = useStore((s) =>
    [...s.nodeLookup.values()].map((n) => `${n.id}:${n.measured.height ?? 0}`).join(","),
  );
  useEffect(() => {
    const height = new Map(
      heights
        .split(",")
        .filter(Boolean)
        .map((pair) => pair.split(":"))
        .map(([id = "", h = "0"]) => [id, Number(h)]),
    );
    const measured = height.size > 0 && [...height.values()].every((h) => h > 0);
    if (!measured) return;
    const ys: Record<string, number> = {};
    const byColumn = new Map<number, string[]>();
    for (const [id, slot] of slots) byColumn.set(slot.x, [...(byColumn.get(slot.x) ?? []), id]);
    for (const ids of byColumn.values()) {
      let y = 0;
      for (const id of ids.sort((a, b) => (slots.get(a)?.row ?? 0) - (slots.get(b)?.row ?? 0))) {
        ys[id] = y;
        y += (height.get(id) ?? 0) + ROW_GAP;
      }
    }
    onStacked(ys);
    const refit = () => fitView({ padding: 0.12, duration: 0 });
    const frame = requestAnimationFrame(refit);
    window.addEventListener("resize", refit);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", refit);
    };
  }, [heights, slots, onStacked, fitView]);
  return null;
}

export function Scene({
  network,
  show,
  arpTables,
  macTables,
  activeNodes,
  activeRoute,
  inFlight,
}: SceneProps) {
  const positions = useMemo(() => layout(network), [network]);
  const [ys, setYs] = useState<Record<string, number>>({});
  // Every render hands React Flow fresh node objects, which makes it re-measure them and re-run
  // the stacking, so an unchanged result must not become a new state or the scene loops forever.
  const stack = useCallback((next: Record<string, number>) => {
    setYs((prev) => (sameYs(prev, next) ? prev : next));
  }, []);
  const nodes: (HostNode | SwitchNode)[] = network.nodes.map((n) => {
    const slot = positions.get(n.id) ?? { x: 0, row: 0 };
    const position = { x: slot.x, y: ys[n.id] ?? slot.row * ROW };
    const active = activeNodes.includes(n.id);
    if (n.kind === "switch") {
      const data: SwitchData = {
        id: n.id,
        ports: n.interfaces.map((p) => p.name),
        macs: macTables[n.id] ?? [],
        active,
      };
      return { id: n.id, type: "switch", position, draggable: false, data };
    }
    const data: HostData = {
      id: n.id,
      kind: n.kind,
      interfaces: n.interfaces,
      arp: show.arp ? (arpTables[n.id] ?? []) : undefined,
      routes: show.routes ? n.routes : undefined,
      activeRoute: active ? activeRoute : undefined,
      active,
    };
    return { id: n.id, type: "host", position, draggable: false, data };
  });
  const metrics = metricsByLink(network);
  const edges: CableEdge[] = network.links.map((l) => {
    const [source = ""] = l.a.split("/");
    const [target = ""] = l.b.split("/");
    const f = inFlight.find((x) => x.link === l.id);
    const flight = f ? { label: f.label, reverse: f.from !== source, key: f.key } : undefined;
    const data: CableData = { id: l.id, inFlight: flight, metric: metrics.get(l.id) };
    return { id: l.id, type: "cable", source, target, data };
  });
  const rows = rowCount(positions);
  return (
    <div className="scene" style={{ height: `${BASE_HEIGHT + (rows - 1) * ROW_HEIGHT}px` }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
      >
        <StackRows slots={positions} onStacked={stack} />
      </ReactFlow>
    </div>
  );
}
