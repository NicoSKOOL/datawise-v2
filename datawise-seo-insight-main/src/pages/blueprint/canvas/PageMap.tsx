import { useMemo } from 'react';
import { ReactFlow, Background, Controls, MiniMap, type Edge, type Node, type NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { layoutBlueprintTree } from './layout';
import { PageCardNode, type PageCardNodeData } from './PageCardNode';
import type { BlueprintGraphNode } from './types';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 96;

const nodeTypes = { pageCard: PageCardNode };

export function PageMap(props: {
  nodes: BlueprintGraphNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const { nodes: graphNodes, selectedId, onSelect } = props;

  const positions = useMemo(
    () => layoutBlueprintTree(graphNodes, { nodeWidth: NODE_WIDTH, nodeHeight: NODE_HEIGHT }),
    [graphNodes]
  );

  const flowNodes = useMemo<Node<PageCardNodeData>[]>(() => {
    return graphNodes.map((node) => {
      const pos = positions.get(node.logicalPageId);
      return {
        id: node.logicalPageId,
        type: 'pageCard',
        position: { x: (pos?.x ?? 0) - NODE_WIDTH / 2, y: pos?.y ?? 0 },
        data: { node, selected: node.logicalPageId === selectedId },
        draggable: false,
        connectable: false,
      };
    });
  }, [graphNodes, positions, selectedId]);

  const flowEdges = useMemo<Edge[]>(() => {
    const ids = new Set(graphNodes.map((node) => node.logicalPageId));
    return graphNodes
      .filter((node) => node.parentLogicalPageId !== null && ids.has(node.parentLogicalPageId))
      .map((node) => ({
        id: `${node.parentLogicalPageId}->${node.logicalPageId}`,
        source: node.parentLogicalPageId as string,
        target: node.logicalPageId,
        type: 'smoothstep',
      }));
  }, [graphNodes]);

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    onSelect(node.id);
  };

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeClick={handleNodeClick}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
