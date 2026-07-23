import type { ContinentId } from "./geography";

export type CountryMetadata = {
  /** ISO 3166-1 numeric code when Natural Earth supplies one. */
  numericId: string | null;
  alpha2: string | null;
  displayName: string;
  continentId: ContinentId;
  featureKey: string;
};

type CountryMetadataLookup = {
  id?: string | number;
  name?: string;
};

/**
 * Compact generated join for every ISO-coded feature in the bundled
 * Natural Earth 1:110m topology. The three disputed Natural Earth-only
 * features are declared separately below so all 177 source geometries have a
 * stable identity without inventing ISO codes for them.
 */
const ISO_CODES_BY_CONTINENT: Record<ContinentId, string> = {
  "continent-океанія": "242:FJ 598:PG 548:VU 540:NC 090:SB 554:NZ 036:AU",
  "continent-африка": "834:TZ 732:EH 180:CD 706:SO 404:KE 729:SD 148:TD 710:ZA 426:LS 716:ZW 072:BW 516:NA 686:SN 466:ML 478:MR 204:BJ 562:NE 566:NG 120:CM 768:TG 288:GH 384:CI 324:GN 624:GW 430:LR 694:SL 854:BF 140:CF 178:CG 266:GA 226:GQ 894:ZM 454:MW 508:MZ 748:SZ 024:AO 108:BI 450:MG 270:GM 788:TN 012:DZ 232:ER 504:MA 818:EG 434:LY 231:ET 262:DJ 800:UG 646:RW 728:SS",
  "continent-північна америка": "124:CA 840:US 332:HT 214:DO 044:BS 304:GL 484:MX 591:PA 188:CR 558:NI 340:HN 222:SV 320:GT 084:BZ 630:PR 388:JM 192:CU 780:TT",
  "continent-азія": "398:KZ 860:UZ 360:ID 626:TL 376:IL 422:LB 275:PS 400:JO 784:AE 634:QA 414:KW 368:IQ 512:OM 116:KH 764:TH 418:LA 104:MM 704:VN 408:KP 410:KR 496:MN 356:IN 050:BD 064:BT 524:NP 586:PK 004:AF 762:TJ 417:KG 795:TM 364:IR 760:SY 051:AM 792:TR 144:LK 156:CN 158:TW 031:AZ 268:GE 608:PH 458:MY 096:BN 392:JP 887:YE 682:SA",
  "continent-південна америка": "032:AR 152:CL 238:FK 858:UY 076:BR 068:BO 604:PE 170:CO 862:VE 328:GY 740:SR 218:EC 600:PY",
  "continent-європа": "643:RU 578:NO 250:FR 752:SE 112:BY 804:UA 616:PL 040:AT 348:HU 498:MD 642:RO 440:LT 428:LV 233:EE 276:DE 100:BG 300:GR 008:AL 191:HR 756:CH 442:LU 056:BE 528:NL 620:PT 724:ES 372:IE 380:IT 208:DK 826:GB 352:IS 705:SI 246:FI 703:SK 203:CZ 196:CY 070:BA 807:MK 688:RS 499:ME",
  "continent-антарктида": "260:TF 010:AQ",
};

const UKRAINIAN_NAME_OVERRIDES: Readonly<Record<string, string>> = {
  AQ: "Антарктида",
  CZ: "Чехія",
  GB: "Велика Британія",
  PS: "Палестина",
  RU: "Росія",
  US: "Сполучені Штати",
};

const displayNames = new Intl.DisplayNames(["uk"], { type: "region" });
const metadataByNumericId = new Map<string, CountryMetadata>();
const metadataByAlpha2 = new Map<string, CountryMetadata>();

for (const [continentId, encodedRows] of Object.entries(
  ISO_CODES_BY_CONTINENT,
) as Array<[ContinentId, string]>) {
  for (const encodedRow of encodedRows.split(" ")) {
    const [numericId, alpha2] = encodedRow.split(":");
    const metadata: CountryMetadata = {
      numericId,
      alpha2,
      displayName:
        UKRAINIAN_NAME_OVERRIDES[alpha2] ?? displayNames.of(alpha2) ?? alpha2,
      continentId,
      featureKey: numericId,
    };
    metadataByNumericId.set(numericId, metadata);
    metadataByAlpha2.set(alpha2, metadata);
  }
}

const NATURAL_EARTH_FALLBACKS: Readonly<Record<string, CountryMetadata>> = {
  "N. Cyprus": {
    numericId: null,
    alpha2: null,
    displayName: "Північний Кіпр",
    continentId: "continent-азія",
    featureKey: "natural-earth-northern-cyprus",
  },
  Somaliland: {
    numericId: null,
    alpha2: null,
    displayName: "Сомаліленд",
    continentId: "continent-африка",
    featureKey: "natural-earth-somaliland",
  },
  Kosovo: {
    numericId: null,
    alpha2: "XK",
    displayName: "Косово",
    continentId: "continent-європа",
    featureKey: "natural-earth-kosovo",
  },
};

const normalizedNumericId = (id: string | number | undefined) => {
  if (id === undefined) return null;
  const value = String(id);
  return /^\d+$/.test(value) ? value.padStart(3, "0") : null;
};

export const countryMetadataForFeature = ({
  id,
  name,
}: CountryMetadataLookup): CountryMetadata | undefined => {
  const numericId = normalizedNumericId(id);
  if (numericId) return metadataByNumericId.get(numericId);
  if (typeof id === "string") {
    const alpha2Match = metadataByAlpha2.get(id.toUpperCase());
    if (alpha2Match) return alpha2Match;
  }
  return name ? NATURAL_EARTH_FALLBACKS[name] : undefined;
};

export const countryMetadataForAlpha2 = (alpha2: string) =>
  metadataByAlpha2.get(alpha2.toUpperCase());

export const BUNDLED_COUNTRY_METADATA_COUNT =
  metadataByNumericId.size + Object.keys(NATURAL_EARTH_FALLBACKS).length;
