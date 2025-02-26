import { PaintContextI, PaintContextWebGL } from "./PaintContext.js";
import PointProcessor, { TimedPoint } from "./PointProcessor.js";
import {
  Parameters,
  Parameter,
  parameterDefinitions
} from "./Parameters.js";
import { colorToHex, parseHex, FloatColor } from "./Color.js";
import fromEntries from "./fromEntries.js";

const loadExample = async (example: string) => {
  return await (await fetch(`../data/${example}.json`)).json();
};

type Stroke = {
  points: TimedPoint[];
};

// Finds a dom element by id, errors if not found, type inference on expected parameter determines return type
function find<T extends HTMLElement>(id: string, expected: { new (): T }): T {
  const elem = document.getElementById(id);
  if (!elem || !(elem instanceof expected)) {
    throw new Error(`Element #${id} is ${elem}, not of type ${expected}`);
  }
  return elem as T;
}

// Fusion of https://basarat.gitbooks.io/typescript/docs/template-strings.html and ObservableHQ's html
function html(templates: TemplateStringsArray, ...placeholders: string[]) {
  let result = "";
  // Simple version w/o escaping because
  // - there is no arbitrary input
  // - we want to let you add children via templates
  // A proper templating implementation is beyond the scope of this project.
  // See https://github.com/observablehq/stdlib/blob/master/src/template.js
  for (let i = 0; i < placeholders.length; i++) {
    result += templates[i];
    result += String(placeholders[i]);
  }
  result += templates[templates.length - 1];
}

type ControlsMap = { [P in keyof Parameters]: HTMLInputElement };

class Controller {
  // Wrapper element of the controls
  controls = find("controls", HTMLDivElement);

  // Lookup table of the controls
  controlsMap: ControlsMap;

  clearButton = find("clear", HTMLButtonElement);

  canvas = find("draw", HTMLCanvasElement);

  // Interface to the actual drawing code
  output: PaintContextI;

  private currentStroke: Stroke | null = null;

  constructor() {
    this.controlsMap = this.createControls();
    this.clearButton.onclick = this.clearCanvas;

    const devicePixelRatio = window.devicePixelRatio || 1;

    const canvas = this.canvas;
    // set the size of the drawing buffer based on the size it's displayed.
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
    canvas.onmousedown = this.handleMouseDown;

    this.output = new PaintContextWebGL(canvas);

    // Start with a stroke on the canvas
    loadExample("heart").then(s => {
      this.currentStroke = s;
      this.drawStroke(s, this.parameters);
    });
  }

  createControls(): ControlsMap {
    const label = (p: Parameter) => `<label for=${p.key}>${p.label}</label>`;
    const makeControl = (d: Parameter) => {
          return `<input type="color" id="${d.key}" />`;
    };
    const row = (p: Parameter) => `
      ${label(p)}
      ${makeControl(p)}
    `;
    // Create a div and fill it with out controls
    const doubled = document.createElement("div");
    const htmlString = parameterDefinitions.map(row).join("\n");
    doubled.innerHTML = htmlString;
    // Now, find controls we just created in the dom
    // In a normal project, we would use refs in React or would be able to
    // use DOM children in templating like ObservableHQ's html`` template literal
    this.controls.appendChild(doubled);

    return fromEntries(
      parameterDefinitions.map(({ key }) => {
        const domElement = find(key, HTMLInputElement);
        domElement.oninput = this.handleParameterChange;
        return [key, domElement];
      })
    );
  }

  clearCanvas = () => {
    this.output.clear();
  };

  drawStroke(stroke: Stroke, p: Parameters) {
    const pp = PointProcessor(p, this.output.drawBrush.bind(this.output));
    let points = stroke.points;
    points.slice(0, points.length - 1).forEach(p => pp.next(p));
    let last = { ...points[points.length - 1], last: true };
    pp.next(last);
  }

  // Look at our controls' states and turn that back into a Parameters object
  get parameters(): Parameters {
    return fromEntries(
      parameterDefinitions.map(
        (d: Parameter): any => {
          const { key, type } = d;
          // c can be undefined if the control wasn't in the map
          let c = this.controlsMap[key];
          if (type === "color") {
            const v = c ? parseHex(c.value) : d.defaultValue;
            return [key, v];
          }
        }
      )
    );
  }

  // Apply these parameter values to the current controls
  set parameters(p: Parameters) {
    parameterDefinitions.forEach(d => {
      const { key, type } = d;
      // Get the correct control
      const c = this.controlsMap[d.key];
      if (!c) return;
      // Set its value correctly based on type
      if (type === "color") {
        const v = p[key] as FloatColor;
        c.value = colorToHex(v);
      }
    });
  }

  private handleParameterChange = (e: Event) => {
    this.clearCanvas();

    if (this.currentStroke) {
      this.drawStroke(this.currentStroke, this.parameters);
    }
  };

  /*
   This construct lets us process a mouse gesture from start to finish.
   If we added a mousemove listener to our element, we would miss out on events when the mouse draws off the edge of the canvas.
   */
  private handleMouseDown = (e: MouseEvent) => {
    const stroke: Stroke = { points: [] };

    // Create a point processor for this stroke
    const pointProcessor = PointProcessor(
      this.parameters,
      this.output.drawBrush.bind(this.output)
    );

    const startTime = e.timeStamp;

    // Define inline to capture any gesture-specific state we need
    const getRelativePosition = (e: MouseEvent): TimedPoint => {
      const { pageX, pageY, timeStamp: t } = e;
      const { left, top } = this.canvas.getBoundingClientRect();
      // In practice, this can't be null
      const scroll = document.scrollingElement!;
      const { scrollTop, scrollLeft } = scroll;
      return {
        // Account for offset of element on page relative to mouse position
        x: pageX - left - scrollLeft,
        y: pageY - top - scrollTop,
        // Round to the nearest millisecond to keep JSON clean
        t: Math.floor(t - startTime)
      };
    };

    // On mouse movement, process the event
    const processEvent = (e: MouseEvent, last?: boolean) => {
      let pt = getRelativePosition(e);
      // Don't write last into json
      stroke.points.push(pt);
      // Do pass it to point processor
      if (last) {
        pt = { ...pt, last };
      }
      pointProcessor.next(pt);
    };
    document.addEventListener("mousemove", processEvent);

    // Remove event listeners on mouseup
    const done = (e: MouseEvent) => {
      // Feed last mouse event to processing
      processEvent(e, true);

      document.removeEventListener("mousemove", processEvent);
      document.removeEventListener("mouseup", done);
      this.currentStroke = stroke;
    };
    document.addEventListener("mouseup", done);

    processEvent(e);
  };
}

// Create single controller instance bound to dom
const controller = new Controller();
