import type { HeatingDay, HeatingHour } from "./simulation-core";

/** Bosch planning document 6721891866 (2025/04), pp. 4 and 81, table 29.
 * The 5 kW model class is not a constant 5 kW heat output.
 */
export const BOSCH_AW5800_5KW = {
  id: "bosch_aw5800_5",
  name: "Bosch Compress 5800i AW 5 OR-S · 5 kW",
  sourceUrl: "https://bosch-de-de.boschhc-documents.com/download/pdf/file/6721891866",
  maxSupplyTemperatureC: 60,
} as const;

// Matched W35 heat output / COP operating points; nominal COPs and SCOP are
// deliberately not mixed with maximum heat output in this first approximation.
const W35 = [
  { outside: -7, power: 5420, cop: 2.51 },
  { outside: 2, power: 6430, cop: 2.91 },
  { outside: 7, power: 6800, cop: 3.16 },
] as const;
const W55_AT_7 = { power: 6180, cop: 2.28 };

export interface HeatPumpOperatingPoint {
  cop: number;
  maxThermalPowerW: number;
}

/** A transparent, conservative stationary approximation, not a Bosch map.
 * Outdoor interpolation uses table 29. Above A7, its values stay fixed; below
 * A-7, no validated operating point is claimed. At other supply temperatures,
 * linear ratios from A7/W35 and A7/W55 are assumed to apply to all outdoor
 * temperatures. Ratios are extrapolated only over W20..W60; below W35 capacity
 * is not increased. Part-load gains, cycling, defrost and auxiliary use have no
 * separate model. A missing field or unsupported range stays unknown.
 */
export function heatPumpOperatingPoint(outdoorC: number | null, supplyC: number | null): HeatPumpOperatingPoint | null {
  if (outdoorC === null || supplyC === null || !Number.isFinite(outdoorC) || !Number.isFinite(supplyC)
    || outdoorC < -7 || outdoorC > 45 || supplyC < 20 || supplyC > BOSCH_AW5800_5KW.maxSupplyTemperatureC) return null;
  const outside = Math.min(7, outdoorC);
  const low = outside <= 2 ? W35[0] : W35[1];
  const high = outside <= 2 ? W35[1] : W35[2];
  const fraction = (outside - low.outside) / (high.outside - low.outside);
  const baseCop = low.cop + fraction * (high.cop - low.cop);
  const basePower = low.power + fraction * (high.power - low.power);
  const supplyFraction = (supplyC - 35) / 20;
  const cop = baseCop * (1 + supplyFraction * (W55_AT_7.cop / W35[2].cop - 1));
  const maxThermalPowerW = basePower * (1 + Math.max(0, supplyFraction) * (W55_AT_7.power / W35[2].power - 1));
  return { cop, maxThermalPowerW };
}

export type HeatPumpHourStatus = "covered" | "off" | "capacity_limited" | "missing_data" | "unreachable" | "outside_model";
export interface HeatPumpHour {
  time: string;
  status: HeatPumpHourStatus;
  cop: number | null;
  maxThermalPowerW: number | null;
  deficitW: number | null;
  electricityKWh: number | null;
}
export interface HeatPumpDay {
  hours: HeatPumpHour[];
  electricityKWh: number | null;
  incompleteHours: number;
  capacityLimitedHours: number;
}

/** One elapsed hour. An uncovered hour never becomes a cheaper partial bill. */
export function estimateHeatPumpHour(hour: HeatingHour): HeatPumpHour {
  const empty: HeatPumpHour = { time: hour.time, status: "missing_data", cop: null, maxThermalPowerW: null, deficitW: null, electricityKWh: null };
  if (!Number.isFinite(Date.parse(hour.time)) || hour.heatDemandW === null || !Number.isFinite(hour.heatDemandW) || hour.heatDemandW < 0) return empty;
  if (hour.status === "off" && hour.heatDemandW === 0) return { ...empty, status: "off", deficitW: 0, electricityKWh: 0 };
  if (hour.status === "unreachable") return { ...empty, status: "unreachable" };
  if (hour.status !== "covered") return empty;
  const point = heatPumpOperatingPoint(hour.outdoorTemperatureC, hour.requiredSupplyTemperatureC);
  if (!point) return { ...empty, status: "outside_model" };
  const deficitW = Math.max(0, hour.heatDemandW - point.maxThermalPowerW);
  if (deficitW > 1e-7) return { ...empty, ...point, status: "capacity_limited", deficitW };
  return { ...empty, ...point, status: "covered", deficitW: 0, electricityKWh: hour.heatDemandW / point.cop / 1000 };
}

/** No heating rod or gas backup is invented for missing compressor capacity. */
export function estimateHeatPumpDay(day: Pick<HeatingDay, "hours">): HeatPumpDay {
  const hours = day.hours.map(estimateHeatPumpHour);
  const validSequence = hours.every((hour, index) => !index || Date.parse(hour.time) - Date.parse(hours[index - 1].time) === 3600000);
  const incompleteHours = hours.filter((hour) => hour.electricityKWh === null).length;
  return { hours, incompleteHours, capacityLimitedHours: hours.filter((hour) => hour.status === "capacity_limited").length,
    electricityKWh: hours.length && validSequence && !incompleteHours ? hours.reduce((sum, hour) => sum + hour.electricityKWh!, 0) : null };
}
