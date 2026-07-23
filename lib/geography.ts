import type { Coordinate } from "./types";

/** WGS84 longitude is [-180, 180), with positive values east of Greenwich. */
export type GeoLevel =
  | "world"
  | "continent"
  | "country"
  | "region"
  | "city"
  | "coordinate";

export type GeoBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type ContinentId =
  | "continent-африка"
  | "continent-антарктида"
  | "continent-азія"
  | "continent-європа"
  | "continent-північна америка"
  | "continent-південна америка"
  | "continent-океанія";

type GeoPosition = readonly [longitude: number, latitude: number];
export type CountryGeometry =
  | { type: "Polygon"; coordinates: readonly (readonly GeoPosition[])[] }
  | {
      type: "MultiPolygon";
      coordinates: readonly (readonly (readonly GeoPosition[])[])[];
    };

export type GeoBreadcrumb = {
  id: string;
  name: string;
  level: GeoLevel;
};

export type GeoSelection = {
  id: string;
  name: string;
  level: GeoLevel;
  bounds: GeoBounds;
  centroid: Coordinate;
  breadcrumbs: GeoBreadcrumb[];
  /** Attach a normalized country feature here to clip samples to its real shape. */
  polygon?: CountryGeometry;
  countryCode?: string;
  sourceNumericId?: string | null;
  continentId?: ContinentId;
};

export type CountryProfile = {
  code: string;
  selection: GeoSelection;
  regions: GeoSelection[];
  cities: GeoSelection[];
};

/** A decoded TopoJSON feature; this keeps the join independent of any fetcher. */
export type CountryFeature = {
  id?: string | number;
  name?: string;
  geometry: CountryGeometry | null;
};

const MAX_POINTS_PER_SELECTION = 6;
const WORLD_BREADCRUMB: GeoBreadcrumb = {
  id: "world",
  name: "Світ",
  level: "world",
};

const bounded = (
  id: string,
  name: string,
  level: GeoLevel,
  bounds: GeoBounds,
  centroid: Coordinate,
  breadcrumbs: GeoBreadcrumb[],
  polygon?: CountryGeometry,
): GeoSelection => ({ id, name, level, bounds, centroid, breadcrumbs, polygon });

export const WORLD_SELECTION = bounded(
  "world",
  "Світ",
  "world",
  { west: -180, south: -90, east: 180, north: 90 },
  { longitude: 20, latitude: 20 },
  [WORLD_BREADCRUMB],
);

const continentSelection = (
  id: string,
  name: string,
  bounds: GeoBounds,
  centroid: Coordinate,
) => bounded(
  id,
  name,
  "continent",
  bounds,
  centroid,
  [WORLD_BREADCRUMB, { id, name, level: "continent" }],
);

/** Canonical Natural Earth 1:110m continent extents used for sampling and focus. */
export const CONTINENT_SELECTIONS: readonly GeoSelection[] = [
  continentSelection(
    "continent-африка",
    "Африка",
    { west: -17.497975, south: -34.785726, east: 51.380035, north: 37.317299 },
    { longitude: 18.178478, latitude: 7.056319 },
  ),
  continentSelection(
    "continent-антарктида",
    "Антарктида",
    { west: -179.999989, south: -89.999933, east: 180, north: -61.076164 },
    { longitude: 82.097175, latitude: -84.936252 },
  ),
  continentSelection(
    "continent-азія",
    "Азія",
    { west: 26.095996, south: 1.265381, east: -169.72915, north: 81.280469 },
    { longitude: 87.975649, latitude: 45.595944 },
  ),
  continentSelection(
    "continent-європа",
    "Європа",
    { west: -9.479736, south: 34.934473, east: 66.364146, north: 71.14209 },
    { longitude: 26.61182, latitude: 54.460515 },
  ),
  continentSelection(
    "continent-північна америка",
    "Північна Америка",
    { west: 172.494824, south: 15.651904, east: -11.425537, north: 83.599609 },
    { longitude: -98.6058, latitude: 53.363676 },
  ),
  continentSelection(
    "continent-південна америка",
    "Південна Америка",
    { west: -81.336621, south: -55.701226, east: -34.887318, north: 12.176615 },
    { longitude: -60.454066, latitude: -13.965314 },
  ),
  continentSelection(
    "continent-океанія",
    "Океанія",
    { west: 112.908203, south: -48.840875, east: -106.462636, north: 25.853583 },
    { longitude: -179.440188, latitude: -13.56495 },
  ),
];

export const WORLD_SAMPLE_POINTS: readonly (Coordinate & { region: string })[] = [
  { region: "Північна Америка", longitude: -106.35, latitude: 56.13 },
  { region: "Південна Америка", longitude: -51.93, latitude: -14.24 },
  { region: "Африка", longitude: 18.18, latitude: 7.06 },
  { region: "Європа", longitude: 19.15, latitude: 51.92 },
  { region: "Азія", longitude: 87.98, latitude: 45.6 },
  { region: "Океанія", longitude: 133.78, latitude: -25.27 },
];

const CONTINENT_BY_NAME = new Map(
  CONTINENT_SELECTIONS.map((selection) => [selection.name, selection]),
);

const profile = (
  code: string,
  country: string,
  continent: string,
  bounds: GeoBounds,
  centroid: Coordinate,
  regions: Array<{ id: string; name: string; bounds: GeoBounds; centroid: Coordinate }>,
  cities: Array<{
    id: string;
    name: string;
    regionId: string;
    bounds: GeoBounds;
    centroid: Coordinate;
  }>,
  countryPolygon?: CountryGeometry,
): CountryProfile => {
  const continentCrumb = CONTINENT_BY_NAME.get(continent)?.breadcrumbs[1];
  if (!continentCrumb) throw new Error(`Unknown continent ${continent}`);
  const countryCrumb: GeoBreadcrumb = { id: code, name: country, level: "country" };
  const selection: GeoSelection = {
    ...bounded(
      code,
      country,
      "country",
      bounds,
      centroid,
      [WORLD_BREADCRUMB, continentCrumb, countryCrumb],
      countryPolygon,
    ),
    countryCode: code,
    continentId: continentCrumb.id as ContinentId,
  };
  const curatedRegions = regions.map((region) =>
    bounded(
      region.id,
      region.name,
      "region",
      region.bounds,
      region.centroid,
      [...selection.breadcrumbs, { id: region.id, name: region.name, level: "region" }],
    ),
  );
  const regionById = new Map(curatedRegions.map((region) => [region.id, region]));

  return {
    code,
    selection,
    regions: curatedRegions,
    cities: cities.map((city) => {
      const region = regionById.get(city.regionId);
      if (!region) throw new Error(`Unknown region ${city.regionId} for ${city.id}`);
      return bounded(
        city.id,
        city.name,
        "city",
        city.bounds,
        city.centroid,
        [...region.breadcrumbs, { id: city.id, name: city.name, level: "city" }],
      );
    }),
  };
};

// Natural Earth 1:110m Ukraine boundary, decoded from countries-110m.json.
const UKRAINE_COUNTRY_POLYGON: CountryGeometry = {
  type: "Polygon",
  coordinates: [[
    [31.786517865178666, 52.10091530970132], [32.1609216092161, 52.06198646182469], [32.412924129241304, 52.28878931467119], [32.715327153271545, 52.23801255657122], [33.75213752137523, 52.33448839696115], [34.3929439294393, 51.769173823448256], [34.1409414094141, 51.5660667910484], [34.223742237422385, 51.25632856663864], [35.0229502295023, 51.20724436714204], [35.379353793537945, 50.77394936468903], [35.35775357753579, 50.57761256670253], [36.62496624966249, 50.22556037720946], [37.39177391773919, 50.38466088592267], [38.010980109801096, 49.915822152799706], [38.59418594185942, 49.925977504419706], [40.070200702007014, 49.601006252579936], [40.081000810008106, 49.3081936142035], [39.67419674196742, 48.78350044717058], [39.89739897398974, 48.231726342484365], [39.73899738997392, 47.89829229762793], [38.77058770587706, 47.82551227768468], [38.2557825578256, 47.546240108134896], [38.22338223382235, 47.10278975406189], [37.424174241742435, 47.021546941101974], [36.75816758167582, 46.69826824786554], [35.822158221582214, 46.64579893116226], [34.961749617496196, 46.273436038429224], [35.012150121501236, 45.736894961172965], [34.860948609486115, 45.767361016032936], [34.73134731347315, 45.96539037262278], [34.41094410944109, 46.00431922049941], [33.69813698136983, 46.21927416312258], [33.435334353343535, 45.97216060703613], [33.29853298532987, 46.08048435764937], [31.743317433174326, 46.33267558954583], [31.674916749167494, 46.706731040882204], [30.74970749707498, 46.58317426283898], [30.378903789037906, 46.03309271675607], [29.604896048960484, 45.293444607099985], [29.151291512915122, 45.464393026036504], [28.67968679686797, 45.303599958719985], [28.233282332823336, 45.48808884648315], [28.485284852848537, 45.59641259709642], [28.661686616866177, 45.94000199357282], [28.935289352893534, 46.25820301099924], [28.863288632886338, 46.43761422295242], [29.072090720907227, 46.517164477309024], [29.169291692916943, 46.380067230439124], [29.75969759697597, 46.34960117557915], [30.026100261002625, 46.42407375412577], [29.838898388983893, 46.525627270325685], [29.907299072990725, 46.674572427418894], [29.558095580955808, 46.92845621791869], [29.414094140941415, 47.346518192941716], [29.05049050490507, 47.51069637746491], [29.122491224912267, 47.84920809813133], [28.67248672486727, 48.11832491606111], [28.258482584825856, 48.15556120533441], [27.52407524075241, 48.4669919883475], [26.858068580685824, 48.368823589354236], [26.62046620466205, 48.221570990864365], [26.195661956619574, 48.221570990864365], [25.947259472594737, 47.9863053450012], [25.209252092520927, 47.89152206321461], [24.86724867248674, 47.737499230311414], [24.402844028440285, 47.98122766919121], [23.76203762037622, 47.9863053450012], [23.14283142831428, 48.0963216542178], [22.710827108271076, 47.88136671159464], [22.642426424264244, 48.15048352952442], [22.084420844208438, 48.422985464660854], [22.282422824228263, 48.82581441225389], [22.559625596255984, 49.086468437167014], [22.775627756277572, 49.02722888605041], [22.520025200252007, 49.47744947453671], [23.42723427234273, 50.308495748772714], [23.924039240392403, 50.42528229240264], [24.028440284402848, 50.706247020555764], [23.52803528035281, 51.57791470127174], [24.00684006840069, 51.61684354914837], [24.554045540455405, 51.88765292568149], [25.3280532805328, 51.91134874612814], [26.339663396633966, 51.831798491771536], [27.455674556745578, 51.59314772870172], [28.240482404824064, 51.57283702546175], [28.618486184861865, 51.42727698557519], [28.992889928899302, 51.601610521718385], [29.255692556925567, 51.36803743445856], [30.15570155701559, 51.41542907535185], [30.555305553055547, 51.318953234961924], [30.620106201062015, 51.823335698754875], [30.92610926109262, 52.04167575858472], [31.786517865178666, 52.10091530970132],
  ]],
};

/**
 * Curated regional and city profiles. They intentionally cover only the listed
 * countries; every other country remains selectable at country/coordinate level.
 */
export const COUNTRY_PROFILES: Record<string, CountryProfile> = {
  UA: profile(
    "UA",
    "Україна",
    "Європа",
    { west: 22.14, south: 44.39, east: 40.23, north: 52.38 },
    { longitude: 31.17, latitude: 48.38 },
    [{ id: "ua-kyiv-region", name: "Київська область", bounds: { west: 29.26, south: 49.18, east: 31.56, north: 51.55 }, centroid: { longitude: 30.65, latitude: 50.1 } }],
    [{ id: "ua-kyiv", name: "Київ", regionId: "ua-kyiv-region", bounds: { west: 30.35, south: 50.35, east: 30.7, north: 50.6 }, centroid: { longitude: 30.52, latitude: 50.45 } }],
    UKRAINE_COUNTRY_POLYGON,
  ),
  PL: profile(
    "PL",
    "Польща",
    "Європа",
    { west: 14.07, south: 49, east: 24.15, north: 54.84 },
    { longitude: 19.15, latitude: 51.92 },
    [{ id: "pl-mazovia", name: "Мазовецьке воєводство", bounds: { west: 19.1, south: 51.9, east: 21.5, north: 53.4 }, centroid: { longitude: 20.63, latitude: 52.25 } }],
    [{ id: "pl-warsaw", name: "Варшава", regionId: "pl-mazovia", bounds: { west: 20.85, south: 52.1, east: 21.2, north: 52.35 }, centroid: { longitude: 21.01, latitude: 52.23 } }],
  ),
  DE: profile(
    "DE",
    "Німеччина",
    "Європа",
    { west: 5.87, south: 47.27, east: 15.04, north: 55.06 },
    { longitude: 10.45, latitude: 51.17 },
    [{ id: "de-berlin-state", name: "Берлін", bounds: { west: 13.08, south: 52.34, east: 13.76, north: 52.68 }, centroid: { longitude: 13.41, latitude: 52.52 } }],
    [{ id: "de-berlin", name: "Берлін", regionId: "de-berlin-state", bounds: { west: 13.2, south: 52.4, east: 13.6, north: 52.6 }, centroid: { longitude: 13.41, latitude: 52.52 } }],
  ),
  FR: profile(
    "FR",
    "Франція",
    "Європа",
    { west: -5.15, south: 41.33, east: 9.56, north: 51.09 },
    { longitude: 2.21, latitude: 46.23 },
    [{ id: "fr-idf", name: "Іль-де-Франс", bounds: { west: 1.45, south: 48.1, east: 3.55, north: 49.25 }, centroid: { longitude: 2.55, latitude: 48.7 } }],
    [{ id: "fr-paris", name: "Париж", regionId: "fr-idf", bounds: { west: 2.22, south: 48.8, east: 2.47, north: 48.92 }, centroid: { longitude: 2.35, latitude: 48.86 } }],
  ),
  IN: profile(
    "IN",
    "Індія",
    "Азія",
    { west: 68.11, south: 6.55, east: 97.4, north: 35.67 },
    { longitude: 78.96, latitude: 22.59 },
    [{ id: "in-delhi", name: "Делі", bounds: { west: 76.84, south: 28.4, east: 77.35, north: 28.88 }, centroid: { longitude: 77.1, latitude: 28.65 } }],
    [{ id: "in-new-delhi", name: "Нью-Делі", regionId: "in-delhi", bounds: { west: 77.1, south: 28.5, east: 77.3, north: 28.72 }, centroid: { longitude: 77.21, latitude: 28.61 } }],
  ),
  JP: profile(
    "JP",
    "Японія",
    "Азія",
    { west: 122.93, south: 24.05, east: 153.99, north: 45.55 },
    { longitude: 138.25, latitude: 36.2 },
    [{ id: "jp-tokyo-prefecture", name: "Токіо", bounds: { west: 138.94, south: 35.5, east: 139.92, north: 35.9 }, centroid: { longitude: 139.69, latitude: 35.68 } }],
    [{ id: "jp-tokyo", name: "Токіо", regionId: "jp-tokyo-prefecture", bounds: { west: 139.55, south: 35.55, east: 139.92, north: 35.82 }, centroid: { longitude: 139.69, latitude: 35.68 } }],
  ),
  BR: profile(
    "BR",
    "Бразилія",
    "Південна Америка",
    { west: -73.99, south: -33.75, east: -34.79, north: 5.27 },
    { longitude: -51.93, latitude: -14.24 },
    [{ id: "br-sao-paulo-state", name: "Сан-Паулу", bounds: { west: -53.11, south: -25.36, east: -44.16, north: -19.78 }, centroid: { longitude: -48.52, latitude: -22.19 } }],
    [{ id: "br-sao-paulo", name: "Сан-Паулу", regionId: "br-sao-paulo-state", bounds: { west: -46.83, south: -24.0, east: -46.35, north: -23.35 }, centroid: { longitude: -46.63, latitude: -23.55 } }],
  ),
  US: profile(
    "US",
    "Сполучені Штати",
    "Північна Америка",
    { west: -124.85, south: 24.4, east: -66.89, north: 49.38 },
    { longitude: -98.58, latitude: 39.83 },
    [{ id: "us-new-york-state", name: "Нью-Йорк", bounds: { west: -79.77, south: 40.49, east: -71.86, north: 45.02 }, centroid: { longitude: -75.5, latitude: 42.95 } }],
    [{ id: "us-new-york-city", name: "Нью-Йорк", regionId: "us-new-york-state", bounds: { west: -74.26, south: 40.49, east: -73.7, north: 40.92 }, centroid: { longitude: -74.01, latitude: 40.71 } }],
  ),
  CA: profile(
    "CA",
    "Канада",
    "Північна Америка",
    { west: -141.01, south: 41.68, east: -52.62, north: 83.11 },
    { longitude: -106.35, latitude: 56.13 },
    [{ id: "ca-ontario", name: "Онтаріо", bounds: { west: -95.16, south: 41.68, east: -74.32, north: 56.86 }, centroid: { longitude: -84.38, latitude: 50.0 } }],
    [{ id: "ca-toronto", name: "Торонто", regionId: "ca-ontario", bounds: { west: -79.65, south: 43.55, east: -79.1, north: 43.9 }, centroid: { longitude: -79.38, latitude: 43.65 } }],
  ),
  AU: profile(
    "AU",
    "Австралія",
    "Океанія",
    { west: 112.92, south: -43.74, east: 153.64, north: -10.69 },
    { longitude: 133.78, latitude: -25.27 },
    [{ id: "au-new-south-wales", name: "Новий Південний Уельс", bounds: { west: 140.99, south: -37.51, east: 153.64, north: -28.16 }, centroid: { longitude: 147.0, latitude: -32.16 } }],
    [{ id: "au-sydney", name: "Сідней", regionId: "au-new-south-wales", bounds: { west: 150.52, south: -34.12, east: 151.35, north: -33.58 }, centroid: { longitude: 151.21, latitude: -33.87 } }],
  ),
};

const NAVIGATION_SELECTION_BY_ID = new Map(
  [
    WORLD_SELECTION,
    ...CONTINENT_SELECTIONS,
    ...Object.values(COUNTRY_PROFILES).flatMap((countryProfile) => [
      countryProfile.selection,
      ...countryProfile.regions,
      ...countryProfile.cities,
    ]),
  ].map((selection) => [selection.id, selection]),
);

export class GeographyRepository {
  private readonly selectionsById = new Map<string, GeoSelection>(
    NAVIGATION_SELECTION_BY_ID,
  );

  registerSelections(selections: readonly GeoSelection[]) {
    for (const selection of selections) {
      this.selectionsById.set(selection.id, selection);
    }
  }

  selection(id: string) {
    return this.selectionsById.get(id);
  }

  resolveBreadcrumb(
    breadcrumb: GeoBreadcrumb,
    current?: GeoSelection,
  ): GeoSelection | undefined {
    return this.selectionsById.get(breadcrumb.id) ??
      (current?.id === breadcrumb.id ? current : undefined);
  }

  countryForCode(countryCode: string | undefined) {
    if (!countryCode) return undefined;
    const normalized = countryCode.toUpperCase();
    return [...this.selectionsById.values()].find(
      (selection) =>
        selection.level === "country" &&
        (selection.countryCode === normalized || selection.id === normalized),
    );
  }

  countryForName(name: string | undefined) {
    if (!name) return undefined;
    const normalized = name.trim().toLocaleLowerCase("uk-UA");
    return [...this.selectionsById.values()].find(
      (selection) =>
        selection.level === "country" &&
        selection.name.toLocaleLowerCase("uk-UA") === normalized,
    );
  }
}

const canonicalGeography = new GeographyRepository();

/** Resolve a hierarchy crumb without borrowing geometry from the current selection. */
export const selectionForBreadcrumb = (
  breadcrumb: GeoBreadcrumb,
  current?: GeoSelection,
): GeoSelection | undefined =>
  canonicalGeography.resolveBreadcrumb(breadcrumb, current);

export const selectionAggregateKey = ({ id, level }: GeoSelection) =>
  `${level}:${id}`;

export type GeocodingIdentity = Coordinate & {
  id: number | string;
  name: string;
  country?: string;
  countryCode?: string;
  admin1?: string;
};

export type SearchSelectionHierarchy = {
  selection: GeoSelection;
  selections: GeoSelection[];
};

const selectionSlug = (value: string) =>
  value
    .normalize("NFKD")
    .toLocaleLowerCase("uk-UA")
    .replace(/[^a-zа-яіїєґ0-9]+/giu, "-")
    .replace(/^-|-$/g, "");

const boundsAround = (coordinate: Coordinate, longitudeRadius: number, latitudeRadius: number) => ({
  west: normalizeLongitude(coordinate.longitude - longitudeRadius),
  south: Math.max(-90, coordinate.latitude - latitudeRadius),
  east: normalizeLongitude(coordinate.longitude + longitudeRadius),
  north: Math.min(90, coordinate.latitude + latitudeRadius),
});

const continentForCoordinate = (coordinate: Coordinate) =>
  CONTINENT_SELECTIONS.find((selection) => isPointInSelection(coordinate, selection)) ??
  CONTINENT_SELECTIONS.reduce((nearest, candidate) => {
    const nearestDistance =
      (nearest.centroid.longitude - coordinate.longitude) ** 2 +
      (nearest.centroid.latitude - coordinate.latitude) ** 2;
    const candidateDistance =
      (candidate.centroid.longitude - coordinate.longitude) ** 2 +
      (candidate.centroid.latitude - coordinate.latitude) ** 2;
    return candidateDistance < nearestDistance ? candidate : nearest;
  });

export const searchSelectionForGeocoding = (
  result: GeocodingIdentity,
  repository: GeographyRepository,
): SearchSelectionHierarchy => {
  const coordinate = { longitude: result.longitude, latitude: result.latitude };
  const knownCountry =
    repository.countryForCode(result.countryCode) ??
    repository.countryForName(result.country);
  const continent = knownCountry
    ? repository.resolveBreadcrumb(
        knownCountry.breadcrumbs.find(({ level }) => level === "continent")!,
      )!
    : continentForCoordinate(coordinate);
  const country = knownCountry ?? bounded(
    `search-country-${selectionSlug(result.country ?? "невідома-країна")}`,
    result.country ?? "Невідома країна",
    "country",
    boundsAround(coordinate, 2.5, 2.5),
    coordinate,
    [
      WORLD_BREADCRUMB,
      continent.breadcrumbs[1],
      {
        id: `search-country-${selectionSlug(result.country ?? "невідома-країна")}`,
        name: result.country ?? "Невідома країна",
        level: "country",
      },
    ],
  );
  const selections: GeoSelection[] = knownCountry ? [] : [country];
  let parentBreadcrumbs = country.breadcrumbs;

  if (result.admin1) {
    const regionId = `search-region-${country.id}-${selectionSlug(result.admin1)}`;
    const region = bounded(
      regionId,
      result.admin1,
      "region",
      boundsAround(coordinate, 0.9, 0.65),
      coordinate,
      [...parentBreadcrumbs, { id: regionId, name: result.admin1, level: "region" }],
    );
    selections.push(region);
    parentBreadcrumbs = region.breadcrumbs;
  }

  const cityId = `search-city-${result.id}`;
  const city = bounded(
    cityId,
    result.name,
    "city",
    boundsAround(coordinate, 0.18, 0.14),
    coordinate,
    [...parentBreadcrumbs, { id: cityId, name: result.name, level: "city" }],
  );
  selections.push(city);
  return { selection: city, selections };
};

/** ISO 3166-1 numeric ids used by world-atlas' Natural Earth topology. */
export const CURATED_COUNTRY_NUMERIC_IDS = {
  UA: "804",
  PL: "616",
  DE: "276",
  FR: "250",
  IN: "356",
  JP: "392",
  BR: "076",
  US: "840",
  CA: "124",
  AU: "036",
} as const;

const CURATED_COUNTRY_CODES_BY_NUMERIC_ID = new Map(
  Object.entries(CURATED_COUNTRY_NUMERIC_IDS).map(([code, numericId]) => [
    numericId,
    code,
  ]),
);

const normalizedNumericCountryId = (id: string | number | undefined) => {
  if (id === undefined) return "";
  const value = String(id);
  return /^\d+$/.test(value) ? value.padStart(3, "0") : value;
};

/**
 * Returns an immutable curated profile joined to a decoded local TopoJSON
 * country feature. Unknown countries intentionally remain country/coordinate-only.
 */
export const profileForCountryFeature = (
  feature: CountryFeature,
): CountryProfile | undefined => {
  const code = CURATED_COUNTRY_CODES_BY_NUMERIC_ID.get(
    normalizedNumericCountryId(feature.id),
  );
  const countryProfile = code ? COUNTRY_PROFILES[code] : undefined;
  if (!countryProfile) return undefined;
  if (!feature.geometry) return countryProfile;

  return {
    ...countryProfile,
    selection: { ...countryProfile.selection, polygon: feature.geometry },
  };
};

export const levelForDistance = (distance: number): GeoLevel => {
  if (distance >= 12) return "world";
  if (distance >= 6) return "continent";
  if (distance >= 4.5) return "country";
  if (distance >= 3.2) return "region";
  if (distance >= 2.2) return "city";
  return "coordinate";
};

const normalizeLongitude = (longitude: number) =>
  ((longitude + 180) % 360 + 360) % 360 - 180;

const longitudeInBounds = (longitude: number, bounds: GeoBounds) =>
  bounds.west <= bounds.east
    ? longitude >= bounds.west && longitude <= bounds.east
    : longitude >= bounds.west || longitude <= bounds.east;

const pointOnSegment = (
  longitude: number,
  latitude: number,
  [startLongitude, startLatitude]: GeoPosition,
  [endLongitude, endLatitude]: GeoPosition,
) => {
  const cross =
    (longitude - startLongitude) * (endLatitude - startLatitude) -
    (latitude - startLatitude) * (endLongitude - startLongitude);
  if (Math.abs(cross) > 1e-9) return false;
  return (
    longitude >= Math.min(startLongitude, endLongitude) &&
    longitude <= Math.max(startLongitude, endLongitude) &&
    latitude >= Math.min(startLatitude, endLatitude) &&
    latitude <= Math.max(startLatitude, endLatitude)
  );
};

const pointInRing = (longitude: number, latitude: number, ring: readonly GeoPosition[]) => {
  const [firstLongitude, firstLatitude] = ring[0];
  const continuousRing = ring.slice(1).reduce<GeoPosition[]>(
    (unwrapped, [candidateLongitude, candidateLatitude]) => {
      const [previousLongitude] = unwrapped.at(-1)!;
      unwrapped.push([
        previousLongitude + normalizeLongitude(candidateLongitude - previousLongitude),
        candidateLatitude,
      ]);
      return unwrapped;
    },
    [[firstLongitude, firstLatitude]],
  );
  const meanLongitude =
    continuousRing.reduce((total, [ringLongitude]) => total + ringLongitude, 0) /
    continuousRing.length;
  const shift = Math.round((longitude - meanLongitude) / 360) * 360;
  const unwrappedRing = continuousRing.map(
    ([ringLongitude, ringLatitude]) => [ringLongitude + shift, ringLatitude] as GeoPosition,
  );
  let inside = false;
  for (let index = 0, previous = unwrappedRing.length - 1; index < unwrappedRing.length; previous = index++) {
    const [x, y] = unwrappedRing[index];
    const [previousX, previousY] = unwrappedRing[previous];
    if (pointOnSegment(longitude, latitude, unwrappedRing[index], unwrappedRing[previous])) return false;
    const intersects =
      y > latitude !== previousY > latitude &&
      longitude < ((previousX - x) * (latitude - y)) / (previousY - y) + x;
    if (intersects) inside = !inside;
  }
  return inside;
};

const pointInGeometry = (point: Coordinate, geometry?: CountryGeometry) => {
  if (!geometry) return true;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(([outer, ...holes]) =>
    pointInRing(point.longitude, point.latitude, outer) &&
    holes.every((hole) => !pointInRing(point.longitude, point.latitude, hole)),
  );
};

export const isPointInSelection = (point: Coordinate, selection: GeoSelection) =>
  point.latitude >= selection.bounds.south &&
  point.latitude <= selection.bounds.north &&
  longitudeInBounds(point.longitude, selection.bounds) &&
  pointInGeometry(point, selection.polygon);

const interpolateLongitude = (bounds: GeoBounds, fraction: number) => {
  const span = bounds.east >= bounds.west ? bounds.east - bounds.west : bounds.east + 360 - bounds.west;
  return normalizeLongitude(bounds.west + span * fraction);
};

const sphericalSeparation = (first: Coordinate, second: Coordinate) => {
  const firstLatitude = (first.latitude * Math.PI) / 180;
  const secondLatitude = (second.latitude * Math.PI) / 180;
  const longitudeDelta =
    (normalizeLongitude(first.longitude - second.longitude) * Math.PI) / 180;
  return 1 - (
    Math.sin(firstLatitude) * Math.sin(secondLatitude) +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.cos(longitudeDelta)
  );
};

/**
 * Deterministic stratified candidates followed by spherical farthest-point
 * selection. This avoids the southwest-first clustering of a row-major grid.
 */
export const sampleSelection = (
  selection: GeoSelection,
  maxPoints: number,
): Coordinate[] => {
  const limit = Math.min(MAX_POINTS_PER_SELECTION, Math.max(0, Math.floor(maxPoints)));
  if (limit === 0) return [];

  const candidates: Coordinate[] = [];
  const addCandidate = (point: Coordinate) => {
    const normalized = { ...point, longitude: normalizeLongitude(point.longitude) };
    if (
      isPointInSelection(normalized, selection) &&
      !candidates.some(
        (candidate) =>
          Math.abs(candidate.longitude - normalized.longitude) < 1e-9 &&
          Math.abs(candidate.latitude - normalized.latitude) < 1e-9,
      )
    ) {
      candidates.push(normalized);
    }
  };

  addCandidate(selection.centroid);
  const strata = 24;
  for (let row = 0; row < strata; row += 1) {
    for (let column = 0; column < strata; column += 1) {
      addCandidate({
        longitude: interpolateLongitude(selection.bounds, (column + 0.5) / strata),
        latitude:
          selection.bounds.south +
          ((selection.bounds.north - selection.bounds.south) * (row + 0.5)) /
            strata,
      });
    }
  }

  if (candidates.length <= limit) return candidates;
  const samples: Coordinate[] = [];
  const centroidIndex = candidates.findIndex(
    (candidate) =>
      candidate.longitude === normalizeLongitude(selection.centroid.longitude) &&
      candidate.latitude === selection.centroid.latitude,
  );
  samples.push(candidates[centroidIndex >= 0 ? centroidIndex : 0]);

  while (samples.length < limit) {
    let bestCandidate: Coordinate | null = null;
    let bestMinimumSeparation = -1;
    for (const candidate of candidates) {
      if (samples.includes(candidate)) continue;
      const minimumSeparation = Math.min(
        ...samples.map((sample) => sphericalSeparation(candidate, sample)),
      );
      if (minimumSeparation > bestMinimumSeparation + 1e-12) {
        bestCandidate = candidate;
        bestMinimumSeparation = minimumSeparation;
      }
    }
    if (!bestCandidate) break;
    samples.push(bestCandidate);
  }

  return samples;
};
