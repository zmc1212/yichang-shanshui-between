#!/usr/bin/env python3
"""Build a compact Yichang DEM grid from the public AWS Terrain Tiles SRTM HGT.

The source HGT is 1 arc-second, WGS84 geographic, signed big-endian int16,
north-to-south rows, with -32768 as void. Output elevations are display-space
metres above an explicitly approximate 40 m river reference, scaled by the
project's 0.02 world-units/metre. The source samples remain separately cited.
"""
import gzip
import json
import math
import os
import struct
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CITY_PATH = ROOT / "public/data/city.json"
OUT_PATH = ROOT / "public/data/elevation/terrain-grid.json"
CACHE = ROOT / ".cache/dem"
TILE = "N30E111"
URL = f"https://s3.amazonaws.com/elevation-tiles-prod/skadi/N30/{TILE}.hgt.gz"
SIDE = 3601
VOID = -32768
CENTER_LON, CENTER_LAT = 111.3075, 30.69
WEST, EAST, SOUTH, NORTH = 111.225, 111.39, 30.625, 30.755
COLS, ROWS = 121, 111
WORLD_UNITS_PER_METER = 0.02
RIVER_REFERENCE_METRES = 40.0  # approximate visual datum, not a surveyed water level

def load_tile():
    CACHE.mkdir(parents=True, exist_ok=True)
    raw_path = CACHE / f"{TILE}.hgt"
    if not raw_path.exists() or raw_path.stat().st_size != SIDE * SIDE * 2:
        CACHE.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(URL, headers={"User-Agent": "YichangOnline-DEM-builder/1.0"})
        with urllib.request.urlopen(request, timeout=180) as response:
            compressed = response.read()
        raw = gzip.decompress(compressed)
        if len(raw) != SIDE * SIDE * 2:
            raise RuntimeError(f"Unexpected HGT byte size: {len(raw)}")
        raw_path.write_bytes(raw)
    raw = raw_path.read_bytes()
    return memoryview(raw)

def sample(tile, lat, lon):
    row = (31.0 - lat) * 3600.0
    col = (lon - 111.0) * 3600.0
    row0, col0 = int(math.floor(row)), int(math.floor(col))
    row1, col1 = min(SIDE - 1, row0 + 1), min(SIDE - 1, col0 + 1)
    if row0 < 0 or col0 < 0 or row0 >= SIDE or col0 >= SIDE:
        return None
    fy, fx = row - row0, col - col0
    values = []
    for rr, cc, weight in (
        (row0, col0, (1-fy)*(1-fx)), (row0, col1, (1-fy)*fx),
        (row1, col0, fy*(1-fx)), (row1, col1, fy*fx),
    ):
        value = struct.unpack_from(">h", tile, (rr * SIDE + cc) * 2)[0]
        if value != VOID and weight > 0:
            values.append((value, weight))
    total = sum(weight for _, weight in values)
    return sum(value * weight for value, weight in values) / total if total else None

def main():
    city = json.loads(CITY_PATH.read_text(encoding="utf-8"))
    meta = city.get("meta", {})
    units = float(meta.get("unitsPerMeter", WORLD_UNITS_PER_METER))
    if abs(units - WORLD_UNITS_PER_METER) > 1e-8:
        raise RuntimeError(f"Unexpected project scale: {units}")
    tile = load_tile()
    heights, valid = [], 0
    for row in range(ROWS):
        lat = NORTH - (NORTH - SOUTH) * row / (ROWS - 1)
        for col in range(COLS):
            lon = WEST + (EAST - WEST) * col / (COLS - 1)
            elevation = sample(tile, lat, lon)
            if elevation is None:
                heights.append(None)
            else:
                # SRTM terrain is above mean sea level. The approximate river
                # datum prevents the city tabletop from becoming a 100 m slab.
                heights.append(round(max(0.0, elevation - RIVER_REFERENCE_METRES) * units, 4))
                valid += 1
    if valid < int(COLS * ROWS * 0.98):
        raise RuntimeError(f"DEM coverage too low: {valid}/{COLS*ROWS}")
    payload = {
        "schemaVersion": 1,
        "source": "AWS Terrain Tiles / Mapzen joerd SRTM 1 arc-second; tile N30E111",
        "sourceUrl": URL,
        "attribution": "Terrain Tiles (Mapzen / Linux Foundation project), SRTM data; accessed 2026-11-16. See https://registry.opendata.aws/terrain-tiles/ and https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
        "horizontalCrs": "EPSG:4326",
        "verticalDatum": "EGM96 mean sea level (SRTM)",
        "sourceResolution": "1 arc-second (approximately 30 m)",
        "displayVerticalReference": "Approximate 40 m river reference; display offset only, not surveyed hydrology",
        "coordinateSystem": "city-local-x-east-z-south",
        "units": "project-world-units",
        "width": 316.0,
        "depth": 289.4,
        "cols": COLS,
        "rows": ROWS,
        "heights": heights,
        "validSamples": valid,
        "noDataSamples": COLS * ROWS - valid,
        "worldUnitsPerMeter": units,
        "boundsWgs84": [WEST, SOUTH, EAST, NORTH],
        "centerWgs84": [CENTER_LON, CENTER_LAT],
        "generation": {"method": "bilinear sample from HGT", "riverReferenceMetres": RIVER_REFERENCE_METRES, "generatedBy": "scripts/build-yichang-dem.py"},
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    finite_heights = [value for value in heights if value is not None]
    print(json.dumps({
        "output": str(OUT_PATH.relative_to(ROOT)), "grid": f"{COLS}x{ROWS}",
        "validSamples": valid, "noDataSamples": len(heights)-valid,
        "displayMin": min(finite_heights), "displayMax": max(finite_heights),
        "bytes": OUT_PATH.stat().st_size, "sourceTile": TILE,
    }, ensure_ascii=False))

if __name__ == "__main__":
    main()
