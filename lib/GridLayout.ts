// @ts-expect-error need to fix
import isEqual from "lodash.isequal";
import {
  bottom,
  cloneLayout,
  cloneLayoutItem,
  compact,
  getAllCollisions,
  getLayoutItem,
  moveElement,
  withLayoutItem,
  correctBounds
} from "./utils";
import {
  getBreakpointFromWidth,
  getColsFromBreakpoint
} from "./responsiveUtils";
import { calcGridItemPosition, calcXY, calcWH, clamp } from "./calculateUtils";
import GridItem from "./GridItem";
import type {
  gridLayoutElementDragDetail,
  gridLayoutElementResizeDetail
} from "./GridItem";

const template = document.createElement("template");
template.innerHTML = `<style>
  :host {
    display: block;
    position: relative;
    transition: height 200ms ease;
  }
  .grid-placeholder {
    background-color: red;
    position: absolute;
    opacity: 0.2;
    z-index: 2;
    transition: none;
  }
  .grid-placeholder_active {
    transition: transform 100ms ease;
  }
</style><div class="grid-placeholder" style="display: none;"></div><slot></slot>`;

export interface GridLayoutElementData {
  i: string;
  x: number;
  y: number;
  h: number;
  w: number;
  isDraggable?: boolean;
  isResizable?: boolean;
  isBounded?: boolean;
  static?: boolean;
  moved?: boolean;
}

interface GridLayoutState {
  autoSize: boolean;
  responsive: boolean;
  layout: Array<GridLayoutElementData>;
  colsNumber: number;
  rowHeight: number;
  columnWidth: number;
  containerPadding: [number, number] | null;
  maxRows: number;
  margin: [number, number];
  compactType: "vertical" | "horizontal";
  allowOverlap: boolean;
  preventCollision: boolean;
  isDraggable: boolean;
  isResizable: boolean;
  isBounded: boolean;
  activeDrag: { x: number; y: number; h: number; w: number } | null;
  oldDragItem: GridLayoutElementData | null;
  oldLayout: Array<GridLayoutElementData> | null;
  oldResizeItem: GridLayoutElementData | null;
}

export default class GridLayout extends HTMLElement {
  declare shadow: ShadowRoot;
  declare placeholder: HTMLDivElement;
  sheet = new CSSStyleSheet();
  observer = new ResizeObserver(() => this.calculateSize());
  breakpoints = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 };
  colsAdaptation = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 };
  containerPadding = { lg: null, md: null, sm: null, xs: null, xxs: null };
  layout: Array<GridLayoutElementData> = [];

  state: GridLayoutState = {
    autoSize: true,
    responsive: true,
    layout: [],
    colsNumber: 12,
    rowHeight: 150,
    columnWidth: 0,
    containerPadding: null,
    maxRows: Infinity, // infinite vertical growth
    margin: [10, 10],
    compactType: "vertical",
    allowOverlap: false,
    preventCollision: false,
    isDraggable: true,
    isResizable: true,
    isBounded: false,
    activeDrag: null,
    oldDragItem: null,
    oldLayout: null,
    oldResizeItem: null
  };

  dragHandler = (event: CustomEvent<gridLayoutElementDragDetail>) => {
    const { detail, target } = event;
    if (!(target instanceof HTMLElement) || target.parentElement !== this) {
      return;
    }

    if (!this.state.isDraggable && !target.hasAttribute("drag")) {
      event.preventDefault();
      return;
    }

    if (detail.life === "start") {
      this.dragStart(detail);
    } else if (detail.life === "move") {
      this.drag(detail);
    } else if (detail.life === "end") {
      this.dragStop(detail);
    }
  };

  resizeHandler = (event: CustomEvent<gridLayoutElementResizeDetail>) => {
    const { detail, target } = event;
    if (!(target instanceof GridItem) || target.parentElement !== this) {
      return;
    }

    if (!this.state.isResizable && !target.hasAttribute("resizable")) {
      event.preventDefault();
      return;
    }

    if (detail.life === "start") {
      this.onResizeStart(detail);
    } else if (detail.life === "move") {
      this.onResize(detail, target);
    } else if (detail.life === "end") {
      this.onResizeStop();
    }
  };

  constructor() {
    super();
  }

  setState(update: Partial<GridLayoutState>) {
    Object.assign(this.state, update);
    this.render();
  }

  dragStart({ key }: gridLayoutElementDragDetail) {
    const { layout } = this.state;
    const l = getLayoutItem(layout, key);
    if (!l) return;

    this.setState({
      oldDragItem: cloneLayoutItem(l),
      oldLayout: layout
    });
  }

  /**
   * Each drag movement create a new dragelement and move the element to the dragged location
   * @param {String} i Id of the child
   * @param {Number} x X position of the move
   * @param {Number} y Y position of the move
   * @param {Event} e The mousedown event
   * @param {Element} node The current dragging DOM element
   */
  drag({ key, top, left }: gridLayoutElementDragDetail) {
    let { layout } = this.state;
    const { colsNumber, allowOverlap, preventCollision } = this.state;
    const l = getLayoutItem(layout, key);
    if (!l) return;

    const { x, y } = calcXY(this.getPositionParams(), top, left, l.w, l.h);
    // Create placeholder (display only)
    const placeholder = {
      w: l.w,
      h: l.h,
      x: l.x,
      y: l.y,
      placeholder: true,
      i: key
    };

    // Move the element to the dragged location.
    const isUserAction = true;
    layout = moveElement(
      layout,
      l,
      x,
      y,
      isUserAction,
      preventCollision,
      this.state.compactType,
      colsNumber,
      allowOverlap
    );

    this.setState({
      layout: allowOverlap
        ? layout
        : compact(layout, this.state.compactType, colsNumber),
      activeDrag: placeholder
    });
  }

  /**
   * When dragging stops, figure out which position the element is closest to and update its x and y.
   * @param  {String} i Index of the child.
   * @param {Number} x X position of the move
   * @param {Number} y Y position of the move
   * @param {Event} e The mousedown event
   * @param {Element} node The current dragging DOM element
   */
  dragStop({ key, top, left }: gridLayoutElementDragDetail) {
    let { layout } = this.state;
    const { colsNumber, preventCollision, allowOverlap } = this.state;
    const l = getLayoutItem(layout, key);
    if (!l) return;

    const { x, y } = calcXY(this.getPositionParams(), top, left, l.w, l.h);
    // Move the element here
    const isUserAction = true;
    layout = moveElement(
      layout,
      l,
      x,
      y,
      isUserAction,
      preventCollision,
      this.state.compactType,
      colsNumber,
      allowOverlap
    );

    // Set state
    const newLayout = allowOverlap
      ? layout
      : compact(layout, this.state.compactType, colsNumber);
    const { oldLayout } = this.state;
    this.setState({
      activeDrag: null,
      layout: newLayout,
      oldDragItem: null,
      oldLayout: null
    });

    this.onLayoutMaybeChanged(newLayout, oldLayout);
  }

  onResizeStart({ key }: gridLayoutElementResizeDetail) {
    const { layout } = this.state;
    const l = getLayoutItem(layout, key);
    if (!l) return;

    this.setState({
      oldResizeItem: cloneLayoutItem(l),
      oldLayout: this.state.layout
    });
  }

  onResize(
    { key, width, height }: gridLayoutElementResizeDetail,
    item: GridItem
  ) {
    const { layout } = this.state;
    const { colsNumber, preventCollision, allowOverlap } = this.state;
    const la = getLayoutItem(layout, key);
    if (!la) {
      return;
    }

    // Get new XY
    let { w, h } = calcWH(this.getPositionParams(), width, height, la.x, la.y);

    // Min/max capping
    w = clamp(w, item.minW, Math.min(item.maxW, colsNumber - la.x));
    h = clamp(h, item.minH, item.maxH);

    const [newLayout, l] = withLayoutItem(
      layout,
      key,
      (l: GridLayoutElementData) => {
        // Something like quad tree should be used
        // to find collisions faster
        let hasCollisions;
        if (preventCollision && !allowOverlap) {
          const collisions = getAllCollisions(layout, { ...l, w, h }).filter(
            (layoutItem: GridLayoutElementData) => layoutItem.i !== l.i
          );
          hasCollisions = collisions.length > 0;

          // If we're colliding, we need adjust the placeholder.
          if (hasCollisions) {
            // adjust w && h to maximum allowed space
            let leastX = Infinity,
              leastY = Infinity;
            collisions.forEach((layoutItem: GridLayoutElementData) => {
              if (layoutItem.x > l.x) leastX = Math.min(leastX, layoutItem.x);
              if (layoutItem.y > l.y) leastY = Math.min(leastY, layoutItem.y);
            });

            if (Number.isFinite(leastX)) l.w = leastX - l.x;
            if (Number.isFinite(leastY)) l.h = leastY - l.y;
          }
        }

        if (!hasCollisions) {
          // Set new width and height.
          l.w = w;
          l.h = h;
        }

        return l;
      }
    );

    // Shouldn't ever happen, but typechecking makes it necessary
    if (!l) return;

    // Create placeholder element (display only)
    const placeholder = {
      w: l.w,
      h: l.h,
      x: l.x,
      y: l.y,
      static: true,
      i: key
    };

    // Re-compact the newLayout and set the drag placeholder.
    this.setState({
      layout: allowOverlap
        ? newLayout
        : compact(newLayout, this.state.compactType, colsNumber),
      activeDrag: placeholder
    });
  }

  onResizeStop() {
    const { layout } = this.state;
    const { colsNumber, allowOverlap } = this.state;

    // Set state
    const newLayout = allowOverlap
      ? layout
      : compact(layout, this.state.compactType, colsNumber);
    const { oldLayout } = this.state;
    this.setState({
      activeDrag: null,
      layout: newLayout,
      oldResizeItem: null,
      oldLayout: null
    });

    this.onLayoutMaybeChanged(newLayout, oldLayout);
  }

  onLayoutMaybeChanged(
    newLayout: Array<GridLayoutElementData>,
    oldLayout: Array<GridLayoutElementData> | null
  ) {
    if (!oldLayout) oldLayout = this.state.layout;

    if (!isEqual(oldLayout, newLayout)) {
      this.dispatchEvent(
        new CustomEvent("layoutChanged", {
          detail: {
            oldLayout: oldLayout,
            layout: newLayout
          }
        })
      );
    }
  }

  getPositionParams() {
    return {
      cols: this.state.colsNumber,
      columnWidth: this.state.columnWidth,
      containerPadding: this.state.containerPadding || this.state.margin,
      containerWidth: this.clientWidth,
      margin: this.state.margin,
      maxRows: this.state.maxRows,
      rowHeight: this.state.rowHeight
    };
  }

  calculateSize() {
    if (!this.isConnected) {
      return;
    }
    const { responsive, compactType } = this.state;
    let { colsNumber, containerPadding: padding } = this.state;
    if (responsive) {
      const breakpoint = getBreakpointFromWidth(
        this.breakpoints,
        this.clientWidth
      );
      const newCols = getColsFromBreakpoint(breakpoint, this.colsAdaptation);
      if (newCols !== colsNumber) {
        colsNumber = this.state.colsNumber = newCols;
        padding = this.state.containerPadding =
          // @ts-expect-error need to fix
          this.containerPadding[breakpoint] || null;
        this.state.layout = compact(
          correctBounds(cloneLayout(this.layout), { cols: colsNumber }),
          compactType,
          colsNumber
        );
        this.render();
      }
    }

    const { rowHeight, margin } = this.state;
    const containerPadding = padding || margin;
    const columnWidth = Math.round(
      (this.clientWidth -
        margin[0] * (colsNumber - 1) -
        containerPadding[0] * 2) /
        colsNumber
    );
    this.state.columnWidth = columnWidth;

    // @ts-expect-error global
    this.sheet.replaceSync(`
      :host {
        --grid-layout-cols: ${colsNumber};
        --grid-element-width: ${columnWidth}px;
        --grid-element-height: ${rowHeight}px;
        --grid-element-margin-left: ${margin[0]}px;
        --grid-element-margin-top: ${margin[1]}px;
        --grid-layout-padding-top: ${containerPadding[0]}px;
        --grid-layout-padding-left: ${containerPadding[1]}px;
      }
    `);
  }

  connectedCallback() {
    this.addEventListener(
      "gridLayoutElementDrag",
      this.dragHandler as EventListener
    );
    this.addEventListener(
      "gridLayoutElementResize",
      this.resizeHandler as EventListener
    );
    this.shadow = this.attachShadow({ mode: "open" });
    // @ts-expect-error global
    this.shadow.adoptedStyleSheets = [this.sheet];
    this.shadow.appendChild(template.content.cloneNode(true));
    this.shadow.addEventListener("slotchange", (e: Event) => {
      const slot = e.target;
      if (!(slot instanceof HTMLSlotElement) || slot.name) {
        return;
      }

      const layout: GridLayoutElementData[] = [];
      const children = slot.assignedNodes();
      const { isDraggable, isResizable, isBounded } = this.state;
      children.forEach((node) => {
        if (!(node instanceof HTMLElement) || !node.id) {
          return;
        }

        const x = Number.parseInt(node.getAttribute("x") || "0");
        const y = Number.parseInt(node.getAttribute("y") || "0");
        const w = Number.parseInt(node.getAttribute("w") || "1");
        const h = Number.parseInt(node.getAttribute("h") || "1");

        const l = {
          i: node.id,
          static: node.hasAttribute("static"),
          isDraggable: node.hasAttribute("drag")
            ? node.getAttribute("drag") !== "false"
            : undefined,
          isResizable: node.hasAttribute("resizable")
            ? node.getAttribute("resizable") !== "false"
            : undefined,
          isBounded: node.hasAttribute("bounded")
            ? node.getAttribute("bounded") !== "false"
            : undefined,
          x,
          y,
          w,
          h
        };
        layout.push(l);

        const drag = (l.isDraggable ?? isDraggable) && !l.static;
        const bounded = drag && isBounded && l.isBounded !== false;
        const resizable = isResizable && !l.static;
        if (drag && !node.hasAttribute("drag")) {
          node.setAttribute("drag", "");
        }
        if (resizable && !node.hasAttribute("resizable")) {
          node.setAttribute("resizable", "");
        }
        if (bounded && !node.hasAttribute("bounded")) {
          node.setAttribute("bounded", "");
        }
      });
      this.layout = cloneLayout(layout);
      const cols = this.state.colsNumber;
      const correctedLayout = correctBounds(layout, { cols });
      this.state.layout = this.state.allowOverlap
        ? correctedLayout
        : compact(correctedLayout, this.state.compactType, cols);
      this.onLayoutMaybeChanged(this.state.layout, null);
      this.render();
    });
    const placeholder =
      this.shadow.querySelector<HTMLDivElement>(".grid-placeholder");
    if (placeholder) {
      this.placeholder = placeholder;
    }
    this.observer.observe(this);
    this.calculateSize();
  }

  attributeChangedCallback(name: string, old: string, newV: string) {
    if (name === "row-height") {
      const rowHeight = Number.parseInt(newV) || this.state.rowHeight;
      if (!rowHeight) {
        return;
      }
      this.state.rowHeight = rowHeight;
      this.calculateSize();
    }
  }

  fastRender(layout: Record<string, GridLayoutElementData>) {
    const arr = ["x", "y"] as const;
    for (const node of this.children) {
      const l = layout[node.id];
      if (!l || !(node instanceof GridItem)) {
        continue;
      }
      arr.forEach(
        (key) =>
          node.state[key] !== l[key] && node.setAttribute(key, String(l[key]))
      );
    }

    const activeDrag = this.state.activeDrag;
    if (!activeDrag) {
      return;
    }
    const pos = calcGridItemPosition(
      this.getPositionParams(),
      activeDrag.x,
      activeDrag.y,
      activeDrag.w,
      activeDrag.h
    );

    this.placeholder.style.transform = `translate(${pos.left}px,${pos.top}px)`;
    this.placeholder.style.width = `${pos.width}px`;
    this.placeholder.style.height = `${pos.height}px`;
  }

  /**
   * Calculates a pixel value for the container.
   * @return {String} Container height in pixels.
   */
  containerHeight(): string {
    const nbRow = bottom(this.state.layout);
    const containerPaddingY = this.state.containerPadding
      ? this.state.containerPadding[1]
      : this.state.margin[1];
    return (
      nbRow * this.state.rowHeight +
      (nbRow - 1) * this.state.margin[1] +
      containerPaddingY * 2 +
      "px"
    );
  }

  render() {
    if (!this.isConnected) {
      return;
    }
    const layout = this.state.layout.reduce(
      (acc: Record<string, GridLayoutElementData>, l) => {
        acc[l.i] = l;
        return acc;
      },
      {}
    );
    const active = this.state.activeDrag;
    this.placeholder.classList.toggle(
      "grid-placeholder_active",
      !!active && this.placeholder.style.display !== "none"
    );
    this.placeholder.style.display = active ? "block" : "none";
    if (this.state.autoSize) {
      this.style.height = this.containerHeight();
    }

    if (this.state.oldDragItem || this.state.oldResizeItem) {
      return this.fastRender(layout);
    }

    const arr = ["x", "y", "w", "h"] as const;
    for (const node of this.children) {
      const l = layout[node.id];
      if (!l || !(node instanceof GridItem)) {
        continue;
      }
      arr.forEach(
        (key) =>
          node.state[key] !== l[key] && node.setAttribute(key, String(l[key]))
      );
    }
  }

  static get observedAttributes() {
    return ["row-height", "drag", "resizable", "bounded"];
  }
}