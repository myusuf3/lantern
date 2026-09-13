import type { Network } from "@lantern/engine";
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
import type { ArpRow } from "./steps.js";

export interface HostData extends Record<string, unknown> {
  id: string;
  interfaces: { name: string; mac: string; ip: string }[];
  arp: ArpRow[] | undefined;
  active: boolean;
}

export interface CableData extends Record<string, unknown> {
  id: string;
  /** A frame crossing this cable during the current step. */
  inFlight?: { label: string; reverse: boolean; key: string };
}

type HostNode = Node<HostData, "host">;
type CableEdge = Edge<CableData, "cable">;

function HostBox({ data }: NodeProps<HostNode>) {
  return (
    <div className={`host${data.active ? " host-active" : ""}`} data-testid={`node-${data.id}`}>
      <Handle type="source" position={Position.Right} className="port" />
      <Handle type="target" position={Position.Left} className="port" />
      <div className="host-name">{data.id}</div>
      <table className="host-table">
        <tbody>
          {data.interfaces.flatMap((i) => [
            <tr key={`${i.name}-name`}>
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
      {data.arp && (
        <table className="host-table arp">
          <caption>ARP table</caption>
          <thead>
            <tr>
              <th>IP</th>
              <th>MAC</th>
              <th>interface</th>
            </tr>
          </thead>
          <tbody>
            {data.arp.length === 0 && (
              <tr>
                <td className="empty" colSpan={3}>
                  empty
                </td>
              </tr>
            )}
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

const nodeTypes = { host: HostBox };
const edgeTypes = { cable: Cable };

interface SceneProps {
  network: Network;
  arpTables: Record<string, ArpRow[]> | undefined;
  activeNode: string | undefined;
  inFlight?: { link: string; from: string; label: string; key: string } | undefined;
}

/** Boxes are 300px wide; this spacing leaves a cable long enough to watch a frame cross. */
const COLUMN = 640;

export function Scene({ network, arpTables, activeNode, inFlight }: SceneProps) {
  const nodes: HostNode[] = network.nodes.flatMap((n, i) =>
    n.kind === "switch"
      ? []
      : [
          {
            id: n.id,
            type: "host" as const,
            position: { x: i * COLUMN, y: 0 },
            draggable: false,
            data: {
              id: n.id,
              interfaces: n.interfaces,
              arp: arpTables?.[n.id],
              active: activeNode === n.id,
            },
          },
        ],
  );
  const edges: CableEdge[] = network.links.map((l) => {
    const [source = "", sourceHandle] = l.a.split("/");
    const [target = "", targetHandle] = l.b.split("/");
    const flight =
      inFlight && inFlight.link === l.id
        ? { label: inFlight.label, reverse: inFlight.from !== source, key: inFlight.key }
        : undefined;
    return {
      id: l.id,
      type: "cable" as const,
      source,
      target,
      data: { id: l.id, ...(flight ? { inFlight: flight } : {}) },
      ...(sourceHandle ? {} : {}),
      ...(targetHandle ? {} : {}),
    };
  });
  return (
    <div className="scene">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
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
