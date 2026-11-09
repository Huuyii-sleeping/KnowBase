import {
  BaseBehavior,
  ExtensionCategory,
  GraphEvent,
  register,
  type BaseBehaviorOptions,
  type RuntimeContext,
} from '@antv/g6';

export const READABLE_GRAPH_LABELS = 'knowbase-readable-labels';
let registered = false;

// G6 5.1.1's fix-element-size interprets relative wheel/zoomBy scale as the
// absolute zoom. Read the camera's actual zoom for both transforms and redraws.
export class ReadableGraphLabels extends BaseBehavior {
  private refresh = () => {
    const { graph, element } = this.context;
    const zoom = graph.getZoom();
    if (!Number.isFinite(zoom) || zoom <= 0) return;
    for (const datum of [...graph.getNodeData(), ...graph.getEdgeData()]) {
      if (datum.id)
        element
          ?.getElement(datum.id)
          ?.getShape('label')
          ?.setLocalScale(1 / zoom);
    }
  };

  constructor(context: RuntimeContext, options: BaseBehaviorOptions) {
    super(context, options);
    context.graph.on(GraphEvent.AFTER_TRANSFORM, this.refresh);
    context.graph.on(GraphEvent.AFTER_DRAW, this.refresh);
  }

  destroy() {
    this.context.graph.off(GraphEvent.AFTER_TRANSFORM, this.refresh);
    this.context.graph.off(GraphEvent.AFTER_DRAW, this.refresh);
    super.destroy();
  }
}

export function registerReadableGraphLabels() {
  if (registered) return;
  register(
    ExtensionCategory.BEHAVIOR,
    READABLE_GRAPH_LABELS,
    ReadableGraphLabels,
  );
  registered = true;
}
