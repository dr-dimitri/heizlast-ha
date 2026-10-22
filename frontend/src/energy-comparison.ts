import type { HassState } from "./types";

export interface PriceInterval { start: string; end: string; priceCtPerKWh: number; lowTariff?: boolean }
export interface MorningStorageOptions { tariffContext: ReadonlyArray<PriceInterval>; timezone: string }
export const MORNING_STORAGE_CAPACITY_KWH = 6;
export const MORNING_STORAGE_PRICE_CT_PER_KWH = 18;
export interface PvEnergyInterval { start: string; end: string; energy_kwh: number | null }
export interface ElectricityHour { time: string; electricityKWh: number | null }
export interface ElectricityComparisonHour extends ElectricityHour {
  gridElectricityKWh: number | null;
  pvElectricityKWh: number | null;
  storageElectricityKWh: number | null;
  storageCostEuro: number | null;
  gridOnlyCostEuro: number | null;
  gridCostEuro: number | null;
  pvOpportunityCostEuro: number | null;
  totalCostEuro: number | null;
}
export interface ElectricityComparison extends Omit<ElectricityComparisonHour, "time"> {
  hours: ElectricityComparisonHour[];
}

const HOUR_MS = 3600000;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const validTime = (value: string): number => /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? Date.parse(value) : NaN;

/** Zustandswerte sind Cent, die SAX-Tarifattribute dagegen Euro je kWh. */
export function priceCtPerKWh(state?: HassState): number | null {
  if (!state || !numberPattern.test(state.state.trim())) return null;
  const value = Number(state.state), unit = state.attributes.unit_of_measurement;
  const price = unit === "ct/kWh" ? value : unit === "EUR/kWh" || unit === "€/kWh" ? value * 100 : null;
  return price !== null && Number.isFinite(price) ? price : null;
}

interface LocalParts { year: number; month: number; day: number; seconds: number; offsetMs: number }
interface DailyWindow { start: number; end: number; price: number }

function timeOfDay(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{2}:\d{2}(?::\d{2})?$/.test(value)) return null;
  const [hour, minute, second = 0] = value.split(":").map(Number);
  return hour < 24 && minute < 60 && second < 60 ? hour * 3600 + minute * 60 + second : null;
}
const insideWindow = (seconds: number, window: DailyWindow): boolean => window.start < window.end
  ? seconds >= window.start && seconds < window.end : seconds >= window.start || seconds < window.end;

/** Tägliche lokale SAX-Fenster entlang der absoluten UTC-Zeitachse aufteilen. */
export function tariffIntervalsForHours(
  hours: ReadonlyArray<{ time: string }>, state: HassState | undefined, timezone: string,
  dynamicSlots?: ReadonlyArray<{ start: string; end: string; price_ct_kwh: number }>,
): PriceInterval[] {
  const attributes = state?.attributes as Record<string, unknown> | undefined;
  if (!attributes) return [];
  if (attributes.tariff_type === "dynamic") {
    return (dynamicSlots ?? []).map((slot) => ({ start: slot.start, end: slot.end, priceCtPerKWh: slot.price_ct_kwh }));
  }
  const current = priceCtPerKWh(state);
  if (current === null || (attributes.unavailable_reason !== null && attributes.unavailable_reason !== undefined)) return [];
  if (attributes.tariff_type === "fixed") {
    return hours.filter((hour) => Number.isFinite(validTime(hour.time))).map((hour) => ({ start: hour.time,
      end: new Date(validTime(hour.time) + HOUR_MS).toISOString(), priceCtPerKWh: current }));
  }
  if (attributes.tariff_type !== "time_of_use" || !finite(attributes.base_price_eur_kwh) || !Array.isArray(attributes.windows)) return [];
  const base = attributes.base_price_eur_kwh * 100;
  if (!Number.isFinite(base)) return [];
  const windows: DailyWindow[] = [];
  for (const value of attributes.windows) {
    if (!value || typeof value !== "object") return [];
    const raw = value as Record<string, unknown>, start = timeOfDay(raw.start), end = timeOfDay(raw.end);
    if (start === null || end === null || start === end || !finite(raw.price_eur_kwh) || !Number.isFinite(raw.price_eur_kwh * 100)) return [];
    windows.push({ start, end, price: raw.price_eur_kwh * 100 });
  }
  const wallBoundaries = [...new Set([0, 86400, ...windows.flatMap((window) => [window.start, window.end])])].sort((a, b) => a - b);
  if (wallBoundaries.slice(0, -1).some((left, index) => windows.filter((window) => insideWindow((left + wallBoundaries[index + 1]) / 2, window)).length > 1)) return [];
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  } catch { return []; }
  const local = (time: number): LocalParts => {
    const parts = Object.fromEntries(formatter.formatToParts(time).map((part) => [part.type, part.value]));
    const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
    const seconds = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
    return { year, month, day, seconds, offsetMs: Date.UTC(year, month - 1, day) + seconds * 1000 - Math.floor(time / 1000) * 1000 };
  };
  const output: PriceInterval[] = [];
  for (const hour of hours) {
    const start = validTime(hour.time), end = start + HOUR_MS;
    if (!Number.isFinite(start)) continue;
    const boundaries = new Set([start, end]), offsets = new Set<number>(), dates = new Set<number>();
    let previous = start, previousOffset = local(start).offsetMs;
    // Auch der Zeitzonenwechsel selbst kann den Preis ändern, wenn seine
    // Wanduhrgrenze wegen der Zeitumstellung tatsächlich nicht vorkommt.
    for (let probe = start; probe <= end; probe += 15 * 60000) {
      const parts = local(probe);
      offsets.add(parts.offsetMs); dates.add(Date.UTC(parts.year, parts.month - 1, parts.day));
      if (parts.offsetMs !== previousOffset) {
        let low = previous, high = probe;
        while (high - low > 1) {
          const middle = Math.floor((low + high) / 2);
          if (local(middle).offsetMs === previousOffset) low = middle;
          else high = middle;
        }
        boundaries.add(high);
      }
      previous = probe; previousOffset = parts.offsetMs;
    }
    for (const date of dates) for (const seconds of wallBoundaries) for (const offset of offsets) {
      const candidate = date + seconds * 1000 - offset;
      if (candidate <= start || candidate >= end) continue;
      const actual = local(candidate);
      if (Date.UTC(actual.year, actual.month - 1, actual.day) === date && actual.seconds === seconds) boundaries.add(candidate);
    }
    const ordered = [...boundaries].sort((a, b) => a - b);
    for (let index = 0; index < ordered.length - 1; index++) {
      const left = ordered[index], right = ordered[index + 1];
      const window = windows.find((value) => insideWindow(local((left + right) / 2).seconds, value));
      output.push({ start: new Date(left).toISOString(), end: new Date(right).toISOString(), priceCtPerKWh: window?.price ?? base,
        lowTariff: window !== undefined && window.price < base });
    }
  }
  return output;
}

interface ParsedInterval<T> { start: number; end: number; value: T }
function parsedIntervals<T extends { start: string; end: string }>(values: ReadonlyArray<T>): ParsedInterval<T>[] {
  return values.map((value) => ({ start: validTime(value.start), end: validTime(value.end), value }));
}

type StoragePlan = { status: "inactive" | "unknown" }
  | { status: "active"; start: number; end: number; remainingKWh: number | null };

/** Nur eindeutig belegte, lückenlose Zeitreihen erlauben eine Speicherannahme. */
function completeIntervals<T>(values: ReadonlyArray<ParsedInterval<T>>, start: number, end: number, valid: (value: T) => boolean): boolean {
  if (values.some((value) => !Number.isFinite(value.start) || !Number.isFinite(value.end) || value.end <= value.start)) return false;
  const relevant = values.filter((value) => value.start < end && value.end > start);
  const boundaries = [...new Set([start, end, ...relevant.flatMap((value) => [Math.max(start, value.start), Math.min(end, value.end)])])].sort((a, b) => a - b);
  return boundaries.slice(0, -1).every((left, index) => {
    const matching = relevant.filter((value) => value.start <= left && value.end >= boundaries[index + 1]);
    return matching.length === 1 && valid(matching[0].value);
  });
}

function morningStoragePlans(
  hours: ReadonlyArray<ElectricityHour>, pv: ReadonlyArray<ParsedInterval<PvEnergyInterval>>,
  options?: MorningStorageOptions,
): { plans: Map<string, StoragePlan>; dayKey: (time: number) => string } {
  const plans = new Map<string, StoragePlan>();
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat("en-CA", { timeZone: options?.timezone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit" }); }
  catch { return { plans, dayKey: () => "" }; }
  const dayKey = (time: number) => Number.isFinite(time) ? formatter.format(time) : "";
  if (!options) return { plans, dayKey };
  const context = parsedIntervals(options.tariffContext).sort((a, b) => a.start - b.start);
  const groups = new Map<string, number[]>();
  for (const hour of hours) {
    const start = validTime(hour.time);
    if (Number.isFinite(start)) groups.set(dayKey(start), [...(groups.get(dayKey(start)) ?? []), start]);
  }
  for (const [key, times] of groups) {
    const start = Math.min(...times), end = Math.max(...times) + HOUR_MS;
    plans.set(key, { status: "unknown" });
    if (times.some((time, index) => index > 0 && time - times[index - 1] !== HOUR_MS)) continue;
    if (!completeIntervals(context, start, end, (value) => finite(value.priceCtPerKWh))) continue;
    // Festpreise und dynamische Reihen tragen keine belegten NT-Fenster.
    if (!context.some((value) => value.value.lowTariff !== undefined)) { plans.set(key, { status: "inactive" }); continue; }
    if (!completeIntervals(pv, start, end, (value) => finite(value.energy_kwh) && value.energy_kwh >= 0)) continue;
    const firstPv = pv.filter((value) => value.end > start && value.start < end && value.value.energy_kwh! > 0)
      .sort((a, b) => a.start - b.start)[0];
    // Ohne belegten PV-Beginn wird kein Speicher bis in den Abend verlängert.
    if (!firstPv || firstPv.start <= start) { plans.set(key, { status: "inactive" }); continue; }
    if (!completeIntervals(context, start - 1, start, (value) => finite(value.priceCtPerKWh))) continue;
    const transitions = context.slice(1).filter((value, index) => value.start === context[index].end
      && context[index].value.lowTariff === true && value.value.lowTariff !== true
      && value.start >= start && value.start < firstPv.start && dayKey(value.start) === key);
    const last = transitions.at(-1);
    plans.set(key, last ? { status: "active", start: last.start, end: firstPv.start, remainingKWh: MORNING_STORAGE_CAPACITY_KWH }
      : { status: "inactive" });
  }
  return { plans, dayKey };
}

/** Zeitgleiche PV und optional einmalig morgens nutzbarer NT-Speicher.
 * Haushaltslast und PV-Speicherung fehlen; PV kostet entgangene Einspeisung.
 */
export function compareHeatingElectricity(
  hours: ReadonlyArray<ElectricityHour>, prices: ReadonlyArray<PriceInterval>,
  pv: ReadonlyArray<PvEnergyInterval> | null, feedInPriceCtPerKWh: number | null,
  storage?: MorningStorageOptions,
): ElectricityComparison {
  const priceValues = parsedIntervals(prices), pvValues = parsedIntervals(pv ?? []);
  const invalidPriceBounds = priceValues.some((value) => !Number.isFinite(value.start) || !Number.isFinite(value.end) || value.end <= value.start);
  const invalidPvBounds = pvValues.some((value) => !Number.isFinite(value.start) || !Number.isFinite(value.end) || value.end <= value.start);
  const seen = new Set<number>();
  const { plans, dayKey } = morningStoragePlans(hours, pvValues, storage);
  let validHours = hours.every((hour, index) => Number.isFinite(validTime(hour.time))
    && (index === 0 || validTime(hour.time) - validTime(hours[index - 1].time) === HOUR_MS));
  const results = hours.map((hour): ElectricityComparisonHour => {
    const start = validTime(hour.time), end = start + HOUR_MS;
    const storagePlan: StoragePlan = plans.get(dayKey(start)) ?? { status: storage ? "unknown" : "inactive" };
    const inStorageWindow = (left: number, right: number) => storagePlan.status === "active" && left < storagePlan.end && right > storagePlan.start;
    const energy = finite(hour.electricityKWh) && hour.electricityKWh >= 0 ? hour.electricityKWh : null;
    const empty: ElectricityComparisonHour = { time: hour.time, electricityKWh: energy, gridElectricityKWh: null, pvElectricityKWh: null,
      storageElectricityKWh: null, storageCostEuro: null, gridOnlyCostEuro: null, gridCostEuro: null, pvOpportunityCostEuro: null, totalCostEuro: null };
    if (!Number.isFinite(start) || seen.has(start)) { validHours = false; return { ...empty, electricityKWh: null }; }
    seen.add(start);
    if (energy === null) {
      if (storagePlan.status === "active" && inStorageWindow(start, end)) storagePlan.remainingKWh = null;
      return empty;
    }
    if (energy === 0) return { ...empty, gridElectricityKWh: 0, pvElectricityKWh: 0, gridOnlyCostEuro: 0,
      storageElectricityKWh: 0, storageCostEuro: 0, gridCostEuro: 0, pvOpportunityCostEuro: 0, totalCostEuro: 0 };
    const relevantPrices = priceValues.filter((value) => value.start < end && value.end > start);
    const relevantPv = pvValues.filter((value) => value.start < end && value.end > start);
    const boundaries = new Set([start, end]);
    for (const value of [...relevantPrices, ...relevantPv]) {
      boundaries.add(Math.max(start, value.start)); boundaries.add(Math.min(end, value.end));
    }
    if (storagePlan.status === "active") for (const boundary of [storagePlan.start, storagePlan.end]) {
      if (boundary > start && boundary < end) boundaries.add(boundary);
    }
    const ordered = [...boundaries].sort((a, b) => a - b);
    let gridOnlyCost = 0, gridCost = 0, pvEnergy = 0, gridEnergy = 0, storageEnergy = 0;
    let storageComplete = true, gridEnergyComplete = true;
    let priceComplete = !invalidPriceBounds, pvComplete = pv !== null && !invalidPvBounds, gridCostComplete = true;
    for (let index = 0; index < ordered.length - 1; index++) {
      const left = ordered[index], right = ordered[index + 1], demand = energy * ((right - left) / HOUR_MS);
      const matchingPrice = relevantPrices.filter((value) => value.start <= left && value.end >= right);
      const matchingPv = relevantPv.filter((value) => value.start <= left && value.end >= right);
      const price = matchingPrice.length === 1 && finite(matchingPrice[0].value.priceCtPerKWh) ? matchingPrice[0].value.priceCtPerKWh : null;
      const pvValue = matchingPv.length === 1 && finite(matchingPv[0].value.energy_kwh) && matchingPv[0].value.energy_kwh >= 0 ? matchingPv[0] : null;
      if (price === null) priceComplete = false;
      else gridOnlyCost += demand * (price / 100);
      if (!pvValue) {
        pvComplete = false;
        if (storagePlan.status === "active" && inStorageWindow(left, right)) { storagePlan.remainingKWh = null; storageComplete = false; }
        continue;
      }
      const produced = pvValue.value.energy_kwh! * ((right - left) / (pvValue.end - pvValue.start));
      const used = Math.min(demand, produced), residual = Math.max(0, demand - used);
      pvEnergy += used;
      if (storagePlan.status === "unknown") {
        if (residual > 0) { storageComplete = false; gridEnergyComplete = false; gridCostComplete = false; }
        continue;
      }
      let stored = 0;
      if (storagePlan.status === "active" && inStorageWindow(left, right)) {
        if (storagePlan.remainingKWh === null || price === null) {
          storagePlan.remainingKWh = null; storageComplete = false; gridEnergyComplete = false; gridCostComplete = false; continue;
        }
        stored = Math.min(residual, storagePlan.remainingKWh);
        storagePlan.remainingKWh -= stored;
        storageEnergy += stored;
      }
      const grid = Math.max(0, residual - stored);
      gridEnergy += grid;
      if (grid === 0) continue;
      if (price === null) gridCostComplete = false;
      else gridCost += grid * (price / 100);
    }
    const opportunity = !pvComplete ? null : pvEnergy === 0 ? 0
      : finite(feedInPriceCtPerKWh) ? pvEnergy * (feedInPriceCtPerKWh / 100) : null;
    const knownGridCost = pvComplete && gridCostComplete && !invalidPriceBounds ? gridCost : null;
    const storageCost = storageComplete && pvComplete ? storageEnergy * (MORNING_STORAGE_PRICE_CT_PER_KWH / 100) : null;
    const total = knownGridCost !== null && opportunity !== null && storageCost !== null ? knownGridCost + opportunity + storageCost : null;
    const safe = (value: number | null) => value !== null && Number.isFinite(value) ? value : null;
    return { ...empty, gridElectricityKWh: pvComplete && gridEnergyComplete ? safe(gridEnergy) : null, pvElectricityKWh: pvComplete ? safe(pvEnergy) : null,
      storageElectricityKWh: storageComplete && pvComplete ? safe(storageEnergy) : null, storageCostEuro: safe(storageCost),
      gridOnlyCostEuro: priceComplete ? safe(gridOnlyCost) : null, gridCostEuro: safe(knownGridCost),
      pvOpportunityCostEuro: safe(opportunity), totalCostEuro: safe(total) };
  });
  const sum = (key: keyof Omit<ElectricityComparisonHour, "time">): number | null => {
    if (!validHours || !results.length || results.some((hour) => hour[key] === null)) return null;
    const value = results.reduce((total, hour) => total + hour[key]!, 0);
    return Number.isFinite(value) ? value : null;
  };
  return { hours: results, electricityKWh: sum("electricityKWh"), gridElectricityKWh: sum("gridElectricityKWh"),
    pvElectricityKWh: sum("pvElectricityKWh"), storageElectricityKWh: sum("storageElectricityKWh"), storageCostEuro: sum("storageCostEuro"), gridOnlyCostEuro: sum("gridOnlyCostEuro"), gridCostEuro: sum("gridCostEuro"),
    pvOpportunityCostEuro: sum("pvOpportunityCostEuro"), totalCostEuro: sum("totalCostEuro") };
}
