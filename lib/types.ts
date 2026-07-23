export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type AirSample = {
  aqi: number;
  pm25: number;
  pm10: number;
  no2: number;
  o3: number;
};

export type DataMode = "live" | "cached" | "demo";

export type AirAggregate = AirSample & {
  sampleCount: number;
  measuredAt: string;
  mode: DataMode;
};

export type AqiCategory = {
  label: string;
  color: string;
};
