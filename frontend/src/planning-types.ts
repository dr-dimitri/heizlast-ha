import source from "../../custom_components/heizlast_ha/planning-data.json";
import type { Point } from "./types";

export type PlanningFloor = "EG" | "OG";
export interface HeatZone {
  id: number; name: string; floor: PlanningFloor; area: number; temperature: number;
  load: number; transmission: number; ventilation: number; page: number; uncertain: boolean;
  solar_windows: { orientation: "N" | "E" | "S" | "W"; area_m2: number }[];
}
export interface SolarAssumptions {
  glazing_fraction: number; g_value: number; shading_factor: number;
  sun_protection_factor: number; incidence_factor: number;
  facade_areas_m2: Record<"N" | "E" | "S" | "W", number>; window_tilt_deg: number;
}
export interface PlanShape {
  key: string; name: string; short: string; floor: PlanningFloor; zone: number;
  area: number | null; poly: Point[] | null; center: Point; label_box: Point;
}
export interface PlanningData {
  schema_version: number;
  calculation_date: string;
  building: { heat_load_w: number; heated_net_floor_area_m2: number; design_outdoor_temperature_c: number };
  room_heat_load_sum_w: number;
  solar_assumptions: SolarAssumptions;
  zones: HeatZone[];
  shapes: PlanShape[];
  floors: Record<PlanningFloor, { bounds: [number, number, number, number]; stairs: Point[] }>;
  sources: { building: { document: string; page: number; sheet: string }; climate: { document: string; page: number; sheet: string }; solar: { document: string; pages: number[]; section: string }; room_sum: { document: string; page: number; sheet: string }; plans: Record<PlanningFloor, { document: string; page: number; sheet: string }> };
  notes: { room_sum: string; geometry: string; solar: string };
}
export const planningData = source as PlanningData;
export const floorName = (floor: PlanningFloor): string => floor === "EG" ? "Erdgeschoss" : "Obergeschoss";
export const shapesForZone = (id: number): PlanShape[] => planningData.shapes.filter((shape) => shape.zone === id);
export const zonesForFloor = (floor: PlanningFloor): HeatZone[] => planningData.zones.filter((zone) => zone.floor === floor);
export const floorLoad = (floor: PlanningFloor): number => zonesForFloor(floor).reduce((sum, zone) => sum + zone.load, 0);
export const polygonPoints = (points: Point[]): string => points.map((point) => point.join(",")).join(" ");
