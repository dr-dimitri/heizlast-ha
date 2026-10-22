// @vitest-environment node
import { describe, expect, it } from "vitest";
import { planningData } from "../src/planning-types";
import { defaultSimulationParameters, defaultSimulationScenario, simulateBuilding,
  type SimulationParameters, type SimulationScenario } from "../src/simulation-core";

const source = () => structuredClone(planningData);
function run(parameters: Partial<SimulationParameters> = {}, scenario: Partial<SimulationScenario> = {}, data = source()) {
  return simulateBuilding(data, { ...defaultSimulationScenario(data), ...scenario },
    { ...defaultSimulationParameters(planningData), ...parameters }, { latitudeDeg: 45 });
}

describe("confirmed floor-heating circuits", () => {
  it("conserves heat, pipe length and water volume across every circle and room", () => {
    const data = source(), before = JSON.stringify(data), parameters = defaultSimulationParameters(data);
    const result = run({}, {}, data), installation = data.underfloor_heating.installation;
    expect(result.valid).toBe(true);
    expect(result.circuits).toHaveLength(installation.circuits.length);
    const pipeLength = installation.circuits.reduce((sum, circuit) => sum + circuit.length_m, 0)
      + installation.circuits.length * parameters.additionalConnectionLengthM;
    const innerRadiusM = (installation.pipe_outer_diameter_mm - 2 * installation.pipe_wall_thickness_mm) / 2000;
    const expectedVolume = pipeLength * Math.PI * innerRadiusM ** 2 * 1000;
    expect(result.circuits.reduce((sum, circuit) => sum + circuit.totalPipeLengthM, 0)).toBeCloseTo(pipeLength, 10);
    expect(result.zones.reduce((sum, zone) => sum + zone.roomPipeLengthM + zone.connectionPipeLengthM, 0)).toBeCloseTo(pipeLength, 10);
    expect(result.zones.reduce((sum, zone) => sum + zone.pipeWaterVolumeL, 0)).toBeCloseTo(expectedVolume, 10);
    expect(result.circuits.reduce((sum, circuit) => sum + circuit.waterVolumeL, 0)).toBeCloseTo(expectedVolume, 10);
    expect(result.circuits.reduce((sum, circuit) => sum + circuit.heatingPowerW, 0)).toBeCloseTo(result.totals!.heatingPowerW, 8);
    for (const circuit of result.circuits) {
      expect(circuit.heatingPowerW).toBeCloseTo(circuit.flowLPerMin * 60 * 1.163 * (35 - circuit.returnTemperatureC), 8);
      expect(circuit.heatingPowerW).toBeCloseTo(circuit.roomHeatingPowerW + circuit.connectionHeatingPowerW, 8);
      expect(circuit.returnTemperatureC).toBeGreaterThan(22);
      expect(circuit.returnTemperatureC).toBeLessThan(35);
    }
    expect(JSON.stringify(data)).toBe(before);
  });

  it("heats the OG corridor only from other rooms' connections and never invents a dedicated loop", () => {
    const data = source(), parameters = defaultSimulationParameters(data), installation = data.underfloor_heating.installation;
    const manifold = installation.manifolds.find((candidate) => candidate.floor === "OG")!;
    const corridorId = manifold.connection_zone_id;
    const result = run(), corridor = result.zones.find((zone) => zone.id === corridorId)!;
    const remote = installation.circuits.filter((circuit) => circuit.zone_id !== manifold.zone_id
      && data.zones.find((zone) => zone.id === circuit.zone_id)!.floor === manifold.floor);
    expect(result.circuits.filter((circuit) => circuit.zoneId === corridorId)).toHaveLength(0);
    expect(corridor.roomPipeLengthM).toBe(0);
    expect(corridor.connectionPipeLengthM).toBe(remote.length * parameters.additionalConnectionLengthM);
    expect(corridor.activeFloorAreaM2).toBeCloseTo(corridor.connectionPipeLengthM * parameters.connectionHeatingWidthM, 10);
    expect(corridor.heatingPowerW).toBeCloseTo(result.circuits.filter((circuit) => remote.some((candidate) => candidate.zone_id === circuit.zoneId))
      .reduce((sum, circuit) => sum + circuit.connectionHeatingPowerW, 0), 8);
    expect(corridor.heatingPowerW).toBeGreaterThan(0);
    expect(run({ additionalConnectionLengthM: 0 }).zones.find((zone) => zone.id === corridorId)!.heatingPowerW).toBe(0);
    expect(run({ connectionHeatingWidthM: 0 }).zones.find((zone) => zone.id === corridorId)!.heatingPowerW).toBe(0);
    const wider = run({ connectionHeatingWidthM: 0.5 }).zones.find((zone) => zone.id === corridorId)!;
    expect(wider.activeFloorAreaM2).toBeLessThanOrEqual(data.zones.find((zone) => zone.id === corridorId)!.area * parameters.activeFloorFraction);
  });

  it("lets longer connections cool the water before a room and distributes unequal loops separately", () => {
    const baseline = run(), longer = run({ additionalConnectionLengthM: 20 });
    const room = source().underfloor_heating.installation.circuits.find((circuit) => circuit.zone_id === 5)!;
    const own = baseline.circuits.filter((circuit) => circuit.zoneId === room.zone_id);
    expect(new Set(own.map((circuit) => circuit.returnTemperatureC)).size).toBeGreaterThan(1);
    expect(longer.zones.find((zone) => zone.id === room.zone_id)!.heatingPowerW)
      .toBeLessThan(baseline.zones.find((zone) => zone.id === room.zone_id)!.heatingPowerW);
    const data = source();
    data.underfloor_heating.installation.circuits.find((circuit) => circuit.zone_id === room.zone_id)!.length_m *= 2;
    const changed = run({}, {}, data);
    expect(changed.circuits.find((circuit) => circuit.zoneId === room.zone_id)!.returnTemperatureC).not.toBe(own[0].returnTemperatureC);
    expect(changed.zones.find((zone) => zone.id === room.zone_id)!.heatLossW).toBe(baseline.zones.find((zone) => zone.id === room.zone_id)!.heatLossW);
  });

  it("treats pipe dimension as water volume without claiming an unmodeled hydraulic calculation", () => {
    const baseline = run(), data = source();
    data.underfloor_heating.installation.pipe_outer_diameter_mm += 2;
    const changed = run({}, {}, data);
    expect(changed.totals!.heatingPowerW).toBe(baseline.totals!.heatingPowerW);
    expect(changed.circuits[0].waterVolumeL).toBeGreaterThan(baseline.circuits[0].waterVolumeL);
  });

  it("responds to assumed flow and respects zero flow, inactive floor and water/surface limits", () => {
    const lowFlow = run({ circuitFlowLPerMin: 0.5 }), highFlow = run({ circuitFlowLPerMin: 2 });
    expect(highFlow.totals!.heatingPowerW).toBeGreaterThan(lowFlow.totals!.heatingPowerW);
    for (const result of [run({ circuitFlowLPerMin: 0 }), run({ activeFloorFraction: 0 }), run({}, { supplyTemperatureC: 22 }),
      run({ maxFloorSurfaceTemperatureC: 15 })]) {
      expect(result.valid).toBe(true);
      expect(result.totals!.heatingPowerW).toBe(0);
      for (const circuit of result.circuits) expect(circuit.heatingPowerW).toBe(0);
    }
    for (const supplyTemperatureC of [22.01, 23, 30, 35, 60]) {
      const result = run({ emissionExponent: 0.5 }, { supplyTemperatureC });
      expect(result.valid).toBe(true);
      for (const zone of result.zones) {
        expect(zone.floorSurfaceTemperatureC).toBeLessThanOrEqual(29 + 1e-10);
        expect(zone.floorSurfaceTemperatureC).toBeLessThanOrEqual(supplyTemperatureC + 1e-10);
        expect(zone.returnTemperatureC).toBeGreaterThan(22);
      }
    }
  });

  it("rejects malformed installation data and returns no partial results", () => {
    const malformed = [
      (data: ReturnType<typeof source>) => data.underfloor_heating.installation.pipe_wall_thickness_mm = 0,
      (data: ReturnType<typeof source>) => data.underfloor_heating.installation.pipe_wall_thickness_mm = 8,
      (data: ReturnType<typeof source>) => data.underfloor_heating.installation.pipe_outer_diameter_mm = NaN,
      (data: ReturnType<typeof source>) => data.underfloor_heating.installation.circuits[0].length_m = Infinity,
      (data: ReturnType<typeof source>) => data.underfloor_heating.installation.circuits[0].length_m = 0,
      (data: ReturnType<typeof source>) => data.underfloor_heating.installation.circuits[0].zone_id = 1000,
      (data: ReturnType<typeof source>) => data.underfloor_heating.installation.circuits = [],
      (data: ReturnType<typeof source>) => data.underfloor_heating.installation.manifolds = [],
      (data: ReturnType<typeof source>) => data.underfloor_heating.installation.manifolds[0].connection_zone_id = 1000,
      (data: ReturnType<typeof source>) => data.underfloor_heating.installation.manifolds[0].zone_id = 11,
      (data: ReturnType<typeof source>) => data.underfloor_heating.installation.manifolds = [
        data.underfloor_heating.installation.manifolds[0], data.underfloor_heating.installation.manifolds[0],
      ],
    ];
    for (const mutate of malformed) {
      const data = source(); mutate(data);
      const result = run({}, {}, data);
      expect(result.valid).toBe(false);
      expect(result.zones).toEqual([]);
      expect(result.circuits).toEqual([]);
      expect(result.totals).toBeNull();
      expect(result.errors.some((error) => error.startsWith("data.underfloor_heating.installation"))).toBe(true);
    }
  });
});
