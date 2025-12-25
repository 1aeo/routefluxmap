/**
 * Geographic utility functions
 * Migrated from ingest/relayAggregator.js and util/lerp.js
 */

const PI = Math.PI;
const PI_D_180 = PI / 180;
const PI_D_4 = PI / 4;
const PI_2 = PI * 2;
const ONE_D_360 = 1 / 360;

/**
 * Convert lat/lng to normalized [0,1] coordinates for WebGL
 * Uses Web Mercator projection
 */
export function getNormalizedPosition(lat: number, lng: number): { x: number; y: number } {
  // Get x value (longitude mapped to 0-1)
  const x = (lng + 180) * ONE_D_360;
  
  // Convert latitude to radians
  const latRad = lat * PI_D_180;
  
  // Get y value using Mercator projection
  const mercN = Math.log(Math.tan(PI_D_4 + latRad / 2));
  const y = 0.5 + mercN / PI_2;
  
  return { x, y };
}

/**
 * Linear interpolation between two values
 */
export function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Check if a point (lng, lat) is inside a polygon ring
 * Uses Ray Casting algorithm
 */
function isPointInPolygon(point: [number, number], vs: [number, number][]): boolean {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];
    
    const intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Find country info from GeoJSON features for a given location
 * Guaranteed to match visual representation on the map
 * Returns { code, name } or null if not found
 */
export function findCountryAtLocation(
  lng: number, 
  lat: number, 
  geojson: GeoJSON.FeatureCollection
): { code: string; name: string } | null {
  if (!geojson || !geojson.features) return null;

  for (const feature of geojson.features) {
    if (!feature.geometry) continue;
    
    let isInside = false;
    const geom = feature.geometry;

    if (geom.type === 'Polygon') {
      const coords = geom.coordinates;
      if (isPointInPolygon([lng, lat], coords[0] as [number, number][])) {
        isInside = true;
      }
    } else if (geom.type === 'MultiPolygon') {
      const coords = geom.coordinates;
      for (const polygon of coords) {
        if (isPointInPolygon([lng, lat], polygon[0] as [number, number][])) {
          isInside = true;
          break;
        }
      }
    }

    if (isInside) {
      const props = feature.properties;
      const code = props?.iso_a2 || props?.ISO_A2 || props?.cc2 || null;
      const name = props?.name || props?.NAME || props?.admin || 'Unknown';
      return code ? { code, name } : null;
    }
  }

  return null;
}

/**
 * Country code conversion maps
 */
export const twoToThree: Record<string, string> = {
  'AD': 'AND', 'AE': 'ARE', 'AF': 'AFG', 'AG': 'ATG', 'AI': 'AIA', 'AL': 'ALB',
  'AM': 'ARM', 'AO': 'AGO', 'AQ': 'ATA', 'AR': 'ARG', 'AS': 'ASM', 'AT': 'AUT',
  'AU': 'AUS', 'AW': 'ABW', 'AX': 'ALA', 'AZ': 'AZE', 'BA': 'BIH', 'BB': 'BRB',
  'BD': 'BGD', 'BE': 'BEL', 'BF': 'BFA', 'BG': 'BGR', 'BH': 'BHR', 'BI': 'BDI',
  'BJ': 'BEN', 'BL': 'BLM', 'BM': 'BMU', 'BN': 'BRN', 'BO': 'BOL', 'BQ': 'BES',
  'BR': 'BRA', 'BS': 'BHS', 'BT': 'BTN', 'BV': 'BVT', 'BW': 'BWA', 'BY': 'BLR',
  'BZ': 'BLZ', 'CA': 'CAN', 'CC': 'CCK', 'CD': 'COD', 'CF': 'CAF', 'CG': 'COG',
  'CH': 'CHE', 'CI': 'CIV', 'CK': 'COK', 'CL': 'CHL', 'CM': 'CMR', 'CN': 'CHN',
  'CO': 'COL', 'CR': 'CRI', 'CU': 'CUB', 'CV': 'CPV', 'CW': 'CUW', 'CX': 'CXR',
  'CY': 'CYP', 'CZ': 'CZE', 'DE': 'DEU', 'DJ': 'DJI', 'DK': 'DNK', 'DM': 'DMA',
  'DO': 'DOM', 'DZ': 'DZA', 'EC': 'ECU', 'EE': 'EST', 'EG': 'EGY', 'EH': 'ESH',
  'ER': 'ERI', 'ES': 'ESP', 'ET': 'ETH', 'FI': 'FIN', 'FJ': 'FJI', 'FK': 'FLK',
  'FM': 'FSM', 'FO': 'FRO', 'FR': 'FRA', 'GA': 'GAB', 'GB': 'GBR', 'GD': 'GRD',
  'GE': 'GEO', 'GF': 'GUF', 'GG': 'GGY', 'GH': 'GHA', 'GI': 'GIB', 'GL': 'GRL',
  'GM': 'GMB', 'GN': 'GIN', 'GP': 'GLP', 'GQ': 'GNQ', 'GR': 'GRC', 'GS': 'SGS',
  'GT': 'GTM', 'GU': 'GUM', 'GW': 'GNB', 'GY': 'GUY', 'HK': 'HKG', 'HM': 'HMD',
  'HN': 'HND', 'HR': 'HRV', 'HT': 'HTI', 'HU': 'HUN', 'ID': 'IDN', 'IE': 'IRL',
  'IL': 'ISR', 'IM': 'IMN', 'IN': 'IND', 'IO': 'IOT', 'IQ': 'IRQ', 'IR': 'IRN',
  'IS': 'ISL', 'IT': 'ITA', 'JE': 'JEY', 'JM': 'JAM', 'JO': 'JOR', 'JP': 'JPN',
  'KE': 'KEN', 'KG': 'KGZ', 'KH': 'KHM', 'KI': 'KIR', 'KM': 'COM', 'KN': 'KNA',
  'KP': 'PRK', 'KR': 'KOR', 'KW': 'KWT', 'KY': 'CYM', 'KZ': 'KAZ', 'LA': 'LAO',
  'LB': 'LBN', 'LC': 'LCA', 'LI': 'LIE', 'LK': 'LKA', 'LR': 'LBR', 'LS': 'LSO',
  'LT': 'LTU', 'LU': 'LUX', 'LV': 'LVA', 'LY': 'LBY', 'MA': 'MAR', 'MC': 'MCO',
  'MD': 'MDA', 'ME': 'MNE', 'MF': 'MAF', 'MG': 'MDG', 'MH': 'MHL', 'MK': 'MKD',
  'ML': 'MLI', 'MM': 'MMR', 'MN': 'MNG', 'MO': 'MAC', 'MP': 'MNP', 'MQ': 'MTQ',
  'MR': 'MRT', 'MS': 'MSR', 'MT': 'MLT', 'MU': 'MUS', 'MV': 'MDV', 'MW': 'MWI',
  'MX': 'MEX', 'MY': 'MYS', 'MZ': 'MOZ', 'NA': 'NAM', 'NC': 'NCL', 'NE': 'NER',
  'NF': 'NFK', 'NG': 'NGA', 'NI': 'NIC', 'NL': 'NLD', 'NO': 'NOR', 'NP': 'NPL',
  'NR': 'NRU', 'NU': 'NIU', 'NZ': 'NZL', 'OM': 'OMN', 'PA': 'PAN', 'PE': 'PER',
  'PF': 'PYF', 'PG': 'PNG', 'PH': 'PHL', 'PK': 'PAK', 'PL': 'POL', 'PM': 'SPM',
  'PN': 'PCN', 'PR': 'PRI', 'PS': 'PSE', 'PT': 'PRT', 'PW': 'PLW', 'PY': 'PRY',
  'QA': 'QAT', 'RE': 'REU', 'RO': 'ROU', 'RS': 'SRB', 'RU': 'RUS', 'RW': 'RWA',
  'SA': 'SAU', 'SB': 'SLB', 'SC': 'SYC', 'SD': 'SDN', 'SE': 'SWE', 'SG': 'SGP',
  'SH': 'SHN', 'SI': 'SVN', 'SJ': 'SJM', 'SK': 'SVK', 'SL': 'SLE', 'SM': 'SMR',
  'SN': 'SEN', 'SO': 'SOM', 'SR': 'SUR', 'SS': 'SSD', 'ST': 'STP', 'SV': 'SLV',
  'SX': 'SXM', 'SY': 'SYR', 'SZ': 'SWZ', 'TC': 'TCA', 'TD': 'TCD', 'TF': 'ATF',
  'TG': 'TGO', 'TH': 'THA', 'TJ': 'TJK', 'TK': 'TKL', 'TL': 'TLS', 'TM': 'TKM',
  'TN': 'TUN', 'TO': 'TON', 'TR': 'TUR', 'TT': 'TTO', 'TV': 'TUV', 'TW': 'TWN',
  'TZ': 'TZA', 'UA': 'UKR', 'UG': 'UGA', 'UM': 'UMI', 'US': 'USA', 'UY': 'URY',
  'UZ': 'UZB', 'VA': 'VAT', 'VC': 'VCT', 'VE': 'VEN', 'VG': 'VGB', 'VI': 'VIR',
  'VN': 'VNM', 'VU': 'VUT', 'WF': 'WLF', 'WS': 'WSM', 'YE': 'YEM', 'YT': 'MYT',
  'ZA': 'ZAF', 'ZM': 'ZMB', 'ZW': 'ZWE',
};

export const threeToTwo: Record<string, string> = Object.fromEntries(
  Object.entries(twoToThree).map(([k, v]) => [v, k])
);

/**
 * Country centroids as fallback for GeoIP (lng, lat)
 * Includes overseas territories for complete coverage
 */
export const countryCentroids: Record<string, [number, number]> = {
  // Countries A-Z (main set)
  'AD': [1.52, 42.55], 'AE': [53.85, 23.42], 'AF': [67.71, 33.94], 'AL': [20.17, 41.15],
  'AM': [45.04, 40.07], 'AO': [17.87, -11.20], 'AR': [-63.62, -38.42], 'AT': [14.55, 47.52],
  'AU': [133.78, -25.27], 'AZ': [47.58, 40.14], 'BA': [17.68, 43.92], 'BD': [90.36, 23.68],
  'BE': [4.47, 50.50], 'BG': [25.49, 42.73], 'BR': [-51.93, -14.24], 'BY': [27.95, 53.71],
  'CA': [-106.35, 56.13], 'CH': [8.23, 46.82], 'CL': [-71.54, -35.68], 'CN': [104.20, 35.86],
  'CO': [-74.30, 4.57], 'CZ': [15.47, 49.82], 'DE': [10.45, 51.17], 'DK': [9.50, 56.26],
  'EE': [25.01, 58.60], 'EG': [30.80, 26.82], 'ES': [-3.75, 40.46], 'FI': [25.75, 61.92],
  'FR': [2.21, 46.23], 'GB': [-3.44, 55.38], 'GE': [43.36, 42.32], 'GR': [21.82, 39.07],
  'HK': [114.11, 22.40], 'HR': [15.20, 45.10], 'HU': [19.50, 47.16], 'ID': [113.92, -0.79],
  'IE': [-8.24, 53.41], 'IL': [34.85, 31.05], 'IN': [78.96, 20.59], 'IR': [53.69, 32.43],
  'IS': [-19.02, 64.96], 'IT': [12.57, 41.87], 'JP': [138.25, 36.20], 'KR': [127.77, 35.91],
  'KZ': [66.92, 48.02], 'LT': [23.88, 55.17], 'LU': [6.13, 49.82], 'LV': [24.60, 56.88],
  'MD': [28.37, 47.41], 'MX': [-102.55, 23.63], 'MY': [101.98, 4.21], 'NL': [5.29, 52.13],
  'NO': [8.47, 60.47], 'NZ': [174.89, -40.90], 'PL': [19.15, 51.92], 'PT': [-8.22, 39.40],
  'RO': [24.97, 45.94], 'RS': [21.01, 44.02], 'RU': [105.32, 61.52], 'SE': [18.64, 60.13],
  'SG': [103.82, 1.35], 'SI': [15.00, 46.15], 'SK': [19.70, 48.67], 'TH': [100.99, 15.87],
  'TR': [35.24, 38.96], 'TW': [120.96, 23.70], 'UA': [31.17, 48.38], 'US': [-95.71, 37.09],
  'VE': [-66.59, 6.42], 'VN': [108.28, 14.06], 'ZA': [22.94, -30.56],
  
  // Americas
  'AG': [-61.80, 17.06],  // Antigua and Barbuda
  'AI': [-63.07, 18.22],  // Anguilla
  'AW': [-69.97, 12.52],  // Aruba
  'BB': [-59.54, 13.19],  // Barbados
  'BL': [-62.83, 17.90],  // Saint Barthelemy
  'BM': [-64.75, 32.32],  // Bermuda
  'BO': [-63.59, -16.29], // Bolivia
  'BS': [-77.40, 25.03],  // Bahamas
  'BZ': [-88.50, 17.19],  // Belize
  'CR': [-83.75, 9.75],   // Costa Rica
  'CU': [-77.78, 21.52],  // Cuba
  'CW': [-68.99, 12.17],  // Curaçao
  'DM': [-61.36, 15.41],  // Dominica
  'DO': [-70.16, 18.74],  // Dominican Republic
  'EC': [-78.18, -1.83],  // Ecuador
  'FK': [-59.55, -51.80], // Falkland Islands
  'GD': [-61.68, 12.12],  // Grenada
  'GS': [-36.59, -54.43], // South Georgia
  'GT': [-90.23, 15.78],  // Guatemala
  'GY': [-58.93, 4.86],   // Guyana
  'HN': [-86.24, 14.64],  // Honduras
  'HT': [-72.29, 18.97],  // Haiti
  'JM': [-77.30, 18.11],  // Jamaica
  'KN': [-62.75, 17.34],  // Saint Kitts and Nevis
  'KY': [-81.25, 19.31],  // Cayman Islands
  'LC': [-60.98, 13.91],  // Saint Lucia
  'MS': [-62.19, 16.74],  // Montserrat
  'NI': [-85.21, 12.87],  // Nicaragua
  'PA': [-80.78, 8.54],   // Panama
  'PE': [-75.02, -9.19],  // Peru
  'PY': [-58.44, -23.44], // Paraguay
  'SR': [-56.03, 3.92],   // Suriname
  'SV': [-88.90, 13.79],  // El Salvador
  'SX': [-63.05, 18.04],  // Sint Maarten
  'TC': [-71.80, 21.69],  // Turks and Caicos
  'TT': [-61.22, 10.69],  // Trinidad and Tobago
  'UY': [-55.77, -32.52], // Uruguay
  'VC': [-61.20, 13.25],  // Saint Vincent and the Grenadines
  'VG': [-64.64, 18.42],  // British Virgin Islands
  
  // Africa
  'BF': [-1.56, 12.24],   // Burkina Faso
  'BI': [29.92, -3.37],   // Burundi
  'BJ': [2.32, 9.31],     // Benin
  'BW': [24.68, -22.33],  // Botswana
  'CD': [21.76, -4.04],   // Democratic Republic of the Congo
  'CF': [20.94, 6.61],    // Central African Republic
  'CG': [15.83, -0.23],   // Republic of the Congo
  'CI': [-5.55, 7.54],    // Ivory Coast
  'CM': [12.35, 7.37],    // Cameroon
  'CV': [-24.01, 16.00],  // Cabo Verde
  'DJ': [42.59, 11.83],   // Djibouti
  'DZ': [1.66, 28.03],    // Algeria
  'EH': [-12.89, 24.22],  // Western Sahara
  'ER': [39.78, 15.18],   // Eritrea
  'ET': [40.49, 9.15],    // Ethiopia
  'GA': [11.61, -0.80],   // Gabon
  'GH': [-1.02, 7.95],    // Ghana
  'GM': [-15.31, 13.44],  // Gambia
  'GN': [-9.70, 9.95],    // Guinea
  'GQ': [10.27, 1.65],    // Equatorial Guinea
  'GW': [-15.18, 11.80],  // Guinea-Bissau
  'KE': [37.91, -0.02],   // Kenya
  'LR': [-9.43, 6.43],    // Liberia
  'LS': [28.23, -29.61],  // Lesotho
  'LY': [17.23, 26.34],   // Libya
  'MA': [-7.09, 31.79],   // Morocco
  'MG': [46.87, -18.77],  // Madagascar
  'ML': [-3.99, 17.57],   // Mali
  'MR': [-10.94, 21.01],  // Mauritania
  'MU': [57.55, -20.35],  // Mauritius
  'MW': [34.30, -13.25],  // Malawi
  'MZ': [35.53, -18.67],  // Mozambique
  'NA': [18.49, -22.96],  // Namibia
  'NE': [8.08, 17.61],    // Niger
  'NG': [8.68, 9.08],     // Nigeria
  'RW': [29.87, -1.94],   // Rwanda
  'SC': [55.45, -4.68],   // Seychelles
  'SD': [30.22, 12.86],   // Sudan
  'SH': [-5.72, -15.93],  // Saint Helena
  'SL': [-11.78, 8.46],   // Sierra Leone
  'SN': [-14.45, 14.50],  // Senegal
  'SO': [46.20, 5.15],    // Somalia
  'SS': [31.31, 6.88],    // South Sudan
  'ST': [6.61, 0.19],     // São Tomé and Príncipe
  'SZ': [31.47, -26.52],  // eSwatini
  'TD': [18.73, 15.45],   // Chad
  'TG': [0.82, 8.62],     // Togo
  'TN': [9.54, 33.89],    // Tunisia
  'TZ': [34.89, -6.37],   // Tanzania
  'UG': [32.29, 1.37],    // Uganda
  'ZM': [27.85, -13.13],  // Zambia
  'ZW': [29.15, -19.02],  // Zimbabwe
  
  // Middle East and Central Asia
  'BH': [50.64, 26.07],   // Bahrain
  'IQ': [43.68, 33.22],   // Iraq
  'JO': [36.24, 30.59],   // Jordan
  'KG': [74.77, 41.20],   // Kyrgyzstan
  'KW': [47.48, 29.31],   // Kuwait
  'LB': [35.86, 33.87],   // Lebanon
  'OM': [55.92, 21.51],   // Oman
  'PS': [35.25, 31.95],   // Palestine
  'QA': [51.18, 25.35],   // Qatar
  'SA': [45.08, 23.89],   // Saudi Arabia
  'SY': [38.20, 34.80],   // Syria
  'TJ': [71.28, 38.86],   // Tajikistan
  'TM': [59.56, 38.97],   // Turkmenistan
  'UZ': [64.59, 41.38],   // Uzbekistan
  'YE': [48.52, 15.55],   // Yemen
  
  // South and Southeast Asia
  'BN': [114.73, 4.54],   // Brunei
  'BT': [90.43, 27.51],   // Bhutan
  'KH': [104.99, 12.57],  // Cambodia
  'KP': [127.51, 40.34],  // North Korea
  'LA': [102.50, 19.86],  // Laos
  'LK': [80.77, 7.87],    // Sri Lanka
  'MM': [95.96, 21.91],   // Myanmar
  'MN': [103.85, 46.86],  // Mongolia
  'MO': [113.54, 22.20],  // Macao
  'MV': [73.22, 3.20],    // Maldives
  'NP': [84.12, 28.39],   // Nepal
  'PH': [121.77, 12.88],  // Philippines
  'PK': [69.35, 30.38],   // Pakistan
  
  // Europe
  'AX': [19.95, 60.20],   // Aland
  'CY': [33.43, 35.13],   // Cyprus
  'FO': [-6.91, 61.89],   // Faroe Islands
  'GG': [-2.54, 49.45],   // Guernsey
  'GI': [-5.35, 36.14],   // Gibraltar
  'IM': [-4.55, 54.24],   // Isle of Man
  'JE': [-2.13, 49.21],   // Jersey
  'LI': [9.56, 47.17],    // Liechtenstein
  'MC': [7.41, 43.74],    // Monaco
  'ME': [19.37, 42.71],   // Montenegro
  'MK': [21.75, 41.51],   // North Macedonia
  'MT': [14.38, 35.94],   // Malta
  'SM': [12.46, 43.94],   // San Marino
  'VA': [12.45, 41.90],   // Vatican
  
  // Pacific Islands
  'CK': [-159.79, -21.24],// Cook Islands
  'FJ': [178.07, -17.71], // Fiji
  'FM': [158.23, 6.88],   // Federated States of Micronesia
  'KI': [-168.73, 1.87],  // Kiribati
  'MH': [171.18, 7.13],   // Marshall Islands
  'NF': [167.95, -29.04], // Norfolk Island
  'NR': [166.93, -0.52],  // Nauru
  'NU': [-169.87, -19.05],// Niue
  'PG': [143.96, -6.31],  // Papua New Guinea
  'PN': [-130.10, -25.07],// Pitcairn Islands
  'PW': [134.58, 7.51],   // Palau
  'SB': [160.16, -9.43],  // Solomon Islands
  'TL': [125.73, -8.87],  // East Timor
  'TO': [-175.20, -21.18],// Tonga
  'TV': [179.20, -7.11],  // Tuvalu
  'VU': [166.96, -15.38], // Vanuatu
  'WS': [-172.10, -13.76],// Samoa
  
  // Other territories
  'AQ': [0.00, -75.25],   // Antarctica
  'BQ': [-68.26, 12.18],  // Bonaire, Sint Eustatius, Saba
  'GL': [-42.60, 71.71],  // Greenland
  'HM': [73.50, -53.08],  // Heard Island
  'IO': [71.88, -6.34],   // British Indian Ocean Territory
  'KM': [43.87, -11.88],  // Comoros
  'TF': [69.35, -49.28],  // French Southern Lands
  'TK': [-171.86, -9.20], // Tokelau
  'UM': [-169.52, 19.28], // US Minor Outlying Islands
  'MF': [-63.05, 18.08],  // Saint Martin (French)
  'XK': [20.90, 42.60],   // Kosovo
  
  // French overseas territories
  'GF': [-53.13, 3.93],   // French Guiana
  'GP': [-61.55, 16.25],  // Guadeloupe
  'MQ': [-61.02, 14.64],  // Martinique
  'RE': [55.54, -21.12],  // Réunion
  'YT': [45.17, -12.83],  // Mayotte
  'NC': [165.62, -21.26], // New Caledonia
  'PF': [-149.41, -17.68],// French Polynesia
  'PM': [-56.33, 46.88],  // Saint Pierre and Miquelon
  'WF': [-176.20, -13.77],// Wallis and Futuna
  
  // US territories
  'PR': [-66.59, 18.22],  // Puerto Rico
  'VI': [-64.90, 18.34],  // US Virgin Islands
  'GU': [144.79, 13.44],  // Guam
  'AS': [-170.13, -14.27],// American Samoa
  'MP': [145.74, 15.18],  // Northern Mariana Islands
};

/**
 * Get fallback coordinates from country code
 * Adds jitter to prevent stacking
 */
export function getCountryCoords(countryCode?: string): { lat: number; lng: number } {
  const cc = (countryCode || 'US').toUpperCase();
  const coords = countryCentroids[cc] || countryCentroids['US'];
  return {
    lat: coords[1] + (Math.random() - 0.5) * 2,
    lng: coords[0] + (Math.random() - 0.5) * 2,
  };
}

/** Pre-computed centroid entries for O(1) iteration */
const CENTROID_ENTRIES = Object.entries(countryCentroids);

/**
 * Find nearest country code for a given coordinate using centroid distance.
 * Fast O(n) scan over ~200 countries using squared distance (no sqrt).
 */
export function findNearestCountry(lng: number, lat: number): string | null {
  let minDist = Infinity;
  let nearest: string | null = null;
  
  for (const [code, centroid] of CENTROID_ENTRIES) {
    const dx = lng - centroid[0];
    const dy = lat - centroid[1];
    const dist = dx * dx + dy * dy;
    if (dist < minDist) {
      minDist = dist;
      nearest = code;
    }
  }
  
  return nearest;
}

/** Country statistics from relay aggregation */
export interface CountryRelayStats {
  relayCount: number;
  bandwidth: number;
}

/** Cache for country relay stats (computed once per RelayData reference) */
const countryStatsCache = new WeakMap<object, Map<string, CountryRelayStats>>();
/** Shared empty map to avoid allocations */
const EMPTY_STATS_MAP: Map<string, CountryRelayStats> = new Map();

/** Relay node shape required for aggregation */
interface RelayNode {
  lng: number;
  lat: number;
  relays: { length: number };
  bandwidth: number;
}

/**
 * Build a map of country code -> relay statistics from relay nodes.
 * Cached per cacheKey object reference for efficiency.
 */
export function getCountryRelayStats(
  nodes: RelayNode[] | null | undefined,
  cacheKey: object | null
): Map<string, CountryRelayStats> {
  if (!nodes?.length) return EMPTY_STATS_MAP;
  
  // Check cache first
  if (cacheKey) {
    const cached = countryStatsCache.get(cacheKey);
    if (cached) return cached;
  }
  
  // Build the map
  const stats = new Map<string, CountryRelayStats>();
  
  for (const node of nodes) {
    const code = findNearestCountry(node.lng, node.lat);
    if (!code) continue;
    
    const existing = stats.get(code);
    if (existing) {
      existing.relayCount += node.relays.length;
      existing.bandwidth += node.bandwidth;
    } else {
      stats.set(code, { relayCount: node.relays.length, bandwidth: node.bandwidth });
    }
  }
  
  // Cache result
  if (cacheKey) {
    countryStatsCache.set(cacheKey, stats);
  }
  
  return stats;
}


