import { sub, length, evalBezier, Point2D, Dot2D } from "./point.js";
import { catmullRomToBezier } from "./math.js";
import { FloatColor } from "./Color.js";
import { Parameters } from "./Parameters.js";
import { DrawBrushFn } from "./PaintContext.js";

const BRUSH_SIZE: number = 8;
const STEP_SIZE: number = 0.12;
const SHARPNESS: number  = 0.73;
const OPACITY: number = 0.3;

export interface TimedPoint extends Point2D {
  // milliseconds since beginning of stroke
  t: number;
  // is this the last point?
  last?: boolean;
}

// This interface ensures you have to pass a TimedPoint to a point processor
// typescript's generator support doesn't type the parameter of the next function
interface PointProcessorI {
  next(value: TimedPoint | null): void;
}

// Filter points that are close together (must move at least _distance_)
function distanceFilter(distance: number, drawBrush: DrawBrushFn): DrawBrushFn {
  let currentPoint: Point2D | null = null;
  return (next, ...rest) => {
    if (!currentPoint || length(sub(currentPoint, next)) > distance) {
      drawBrush(next, ...rest);
      currentPoint = next;
      return true;
    }

    return false;
  };
}

function getMoveMin(difMS: number): number {
    return difMS > 10 ? (difMS > 25 ? (difMS > 50 ? (difMS > 100 ? 0.1 : 1.5) : 5) : 12) : 20;
}

// Returns nothing, but keep calling it with next(nextPoint) to pass more input
// This generator will call drawBrush as appropriate
function* PointProcessor(
  {
    color,
  }: Parameters,
  drawBrush: DrawBrushFn
): PointProcessorI {
  // Only draw if we've moved at least stepSize
  const output = distanceFilter(STEP_SIZE * BRUSH_SIZE, drawBrush);

  // Multiply opacity into color value
  const finalColor = color.map(c => c * OPACITY) as FloatColor;

  // Accept 4 input points before starting interpolation and drawing
  let p0 = yield;
  let p1 = yield;
  let p2 = yield;
  let p3 = yield;

  let timeMS = Date.now();
  let difMS: number;
  let moveMin: number;

  // Keep accepting points until we're done
  do {
    const newPt = yield;
    // Last point, we pass in null to trigger emitting the last segment
    difMS = Date.now() - timeMS;
    moveMin = getMoveMin(difMS);

    // Reject point if step less than threshold
    if (newPt?.last === true || length(sub(p3 as TimedPoint, newPt as any)) > moveMin) {
      let repeat = newPt?.last ? 3 : 1;

      for (let i = 0; i < repeat; i++) {
        // Shift in new point
        // if this is a repeat, fills up with newPoint over time
        [p0, p1, p2, p3] = [p1, p2, p3, newPt];

        const bez = catmullRomToBezier([p0 as any, p1 as any, p2 as any, p3 as any]);

        // Estimate # of points
        // Since we use a filter that applies on output, it's OK to over-estimate
        const ptCount = (length(sub(p0 as any, p3 as any)) / STEP_SIZE) * 2.0;
        const pts = evalBezier(bez, ptCount);

        pts.forEach(pt => {
            output(pt, BRUSH_SIZE, SHARPNESS, finalColor);
        });
      }

      timeMS = Date.now();
    }

  } while (!p3?.last);
}

PointProcessor.extraEndPoints = 3;

export default PointProcessor;
