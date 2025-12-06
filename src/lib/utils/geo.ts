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
 */
export const countryCentroids: Record<string, [number, number]> = {
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
  'VN': [108.28, 14.06], 'ZA': [22.94, -30.56],
};

/**
 * Get fallback coordinates from country code
 * Adds jitter to prevent stacking
 */
export function getCountryCoords(countryCode: string): { lat: number; lng: number } {
  const cc = (countryCode || 'US').toUpperCase();
  const coords = countryCentroids[cc] || countryCentroids['US'];
  return {
    lat: coords[1] + (Math.random() - 0.5) * 2,
    lng: coords[0] + (Math.random() - 0.5) * 2,
  };
}


