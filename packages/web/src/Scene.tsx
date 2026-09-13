import type { Network, Route } from "@lantern/engine";
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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
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
      <EdgeLabelRenderer>
        <div
          className="cable-label"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 24}px)` }}
        >
          {flight ? flight.label : data?.id}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { host: HostBox, switch: SwitchBox };
const edgeTypes = { cable: Cable };

export interface SceneProps {
  network: Network;
  show: { arp: boolean; routes: boolean };
  arpTables: Record<string, ArpRow[]>;
  macTables: Record<string, MacRow[]>;
  activeNode: string | undefined;
  activeRoute: HostData["activeRoute"];
  inFlight?: { link: string; from: string; label: string; key: string } | undefined;
}

/** Boxes are 300px wide; this spacing leaves a cable long enough to watch a frame cross. */
const COLUMN = 640;

export function Scene({
  network,
  show,
  arpTables,
  macTables,
  activeNode,
  activeRoute,
  inFlight,
}: SceneProps) {
  const nodes: (HostNode | SwitchNode)[] = network.nodes.map((n, i) => {
    const position = { x: i * COLUMN, y: 0 };
    const active = activeNode === n.id;
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
  const edges: CableEdge[] = network.links.map((l) => {
    const [source = ""] = l.a.split("/");
    const [target = ""] = l.b.split("/");
    const flight =
      inFlight && inFlight.link === l.id
        ? { label: inFlight.label, reverse: inFlight.from !== source, key: inFlight.key }
        : undefined;
    return { id: l.id, type: "cable", source, target, data: { id: l.id, inFlight: flight } };
  });
  return (
    <div className="scene">
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
      />
    </div>
  );
}
