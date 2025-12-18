# Country Boundaries (GeoJSON)

RouteFluxMap uses a world countries polygon GeoJSON for the country choropleth layer.

## Primary (bundled)

- **File**: `public/data/countries.geojson` (served by the site as `/data/countries.geojson`)
- **Identifies as**: `ne_10m_admin_0_countries` (Natural Earth)
- **License**: Natural Earth data is public domain; attribution is appreciated.
- **Source**: `https://www.naturalearthdata.com/downloads/10m-cultural-vectors/`

## Fallback (runtime fetch if local asset is missing)

If the bundled file is unavailable, the app may fetch a pinned fallback:

- **Repo**: `https://github.com/datasets/geo-countries`
- **Dataset version (`datapackage.json`)**: `0.2.0`
- **License (`datapackage.json`)**: ODC-PDDL-1.0 (Public Domain Dedication and License)
- **Pinned commit**: `b0b7794e15e7ec4374bf183dd73cce5b92e1c0ae`
- **File**: `data/countries.geojson`
- **Raw URL**: `https://raw.githubusercontent.com/datasets/geo-countries/b0b7794e15e7ec4374bf183dd73cce5b92e1c0ae/data/countries.geojson`


