import { FloatColor, parseHex } from "./Color.js";
import fromEntries from "./fromEntries.js";

export type Parameter = ParameterBase &
  (ColorParameter);

export interface ParameterBase {
  key: keyof Parameters;
  label: string;
  defaultValue: any;
}

export interface ColorParameter extends ParameterBase {
  type: "color";
  defaultValue: string;
}

export const parameterDefinitions: Parameter[] = [
  {
    key: "color",
    label: " color",
    type: "color",
    defaultValue: "#333333"
  }
];

export type Parameters = Readonly<{
  color: FloatColor;
}>;

export const sanitize = (u: Partial<Parameters>): Parameters => {
  return fromEntries(
    parameterDefinitions.map(p => {
      const { key, type, defaultValue } = p;
      const v = u[key];
      if (v === undefined) {
        return [key, defaultValue];
      }
      if (type === "color") {
        if (
          Array.isArray(v) &&
          v.length === 4 &&
          v.every(k => typeof k === "number")
        ) {
          return [key, v];
        } else {
          return [key, defaultValue];
        }
      } else {
        throw new Error("Unknown type");
      }
    })
  );
};
