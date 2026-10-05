import source from "../../custom_components/heizlast_ha/planning-data.json";
import type { Point } from "./types";

export type PlanningFloor = "EG" | "OG";
export interface HeatZone {
  id: number; name: string; floor: PlanningFloor; area: number; temperature: number;
  load: number; transmission: number; ventilation: number; page: number; uncertain: boolean;
}
export interface PlanShape {
  key: string; name: string; short: string; floor: PlanningFloor; zone: number;
  area: number | null; poly: Point[] | null; center: Point;
}
export interface PlanningData {
  schema_version: number;
  calculation_date: string;
  building: { heat_load_w: number; heated_net_floor_area_m2: number };
  room_heat_load_sum_w: number;
  zones: HeatZone[];
  shapes: PlanShape[];
  floors: Record<PlanningFloor, { bounds: [number, number, number, number]; stairs: Point[] }>;
  sources: { building: { document: string; page: number; sheet: string }; room_sum: { document: string; page: number; sheet: string }; plans: Record<PlanningFloor, { document: string; page: number; sheet: string }> };
  notes: { room_sum: string; geometry: string };
}
export const planningData = source as PlanningData;
export const floorName = (floor: PlanningFloor): string => floor === "EG" ? "Erdgeschoss" : "Obergeschoss";
export const shapesForZone = (id: number): PlanShape[] => planningData.shapes.filter((shape) => shape.zone === id);
export const zonesForFloor = (floor: PlanningFloor): HeatZone[] => planningData.zones.filter((zone) => zone.floor === floor);
export const floorLoad = (floor: PlanningFloor): number => zonesForFloor(floor).reduce((sum, zone) => sum + zone.load, 0);
export const polygonPoints = (points: Point[]): string => points.map((point) => point.join(",")).join(" ");
