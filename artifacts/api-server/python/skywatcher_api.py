"""JSON-line adapter for the original Skywatcher astronomy engine."""

from __future__ import annotations

import json
import sys
from datetime import timezone
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path


def load_engine_module():
    workspace_root = Path(__file__).resolve().parents[3]
    source_path = workspace_root / "attached_assets" / (
        "Pasted--usr-bin-env-python3-Skywatcher-a-terminal-planetarium-_1792144238791.txt"
    )
    if not source_path.is_file():
        raise RuntimeError("The supplied Skywatcher astronomy source file is missing.")

    loader = SourceFileLoader("skywatcher_source", str(source_path))
    spec = spec_from_loader(loader.name, loader)
    if spec is None:
        raise RuntimeError("Could not load the supplied Skywatcher astronomy source.")
    module = module_from_spec(spec)
    sys.modules[spec.name] = module
    loader.exec_module(module)
    return module


def iso_utc(value):
    if value is None:
        return None
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def respond(payload: dict, exit_code: int = 0) -> int:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    return exit_code


def main() -> int:
    try:
        request = json.load(sys.stdin)
        location_text = request.get("location")
        if not isinstance(location_text, str) or not location_text.strip():
            return respond(
                {"error": "Enter a city name or latitude,longitude coordinates.", "kind": "location"},
                2,
            )
        if len(location_text) > 200:
            return respond({"error": "Location must be 200 characters or fewer.", "kind": "location"}, 2)
    except (json.JSONDecodeError, AttributeError, TypeError):
        return respond({"error": "The location request was not valid JSON.", "kind": "input"}, 2)

    try:
        engine_module = load_engine_module()
    except Exception as exc:
        return respond({"error": f"Could not load the Skywatcher engine: {exc}", "kind": "engine"}, 3)

    try:
        location = engine_module.resolve_location(location_text)
    except engine_module.SkywatcherError as exc:
        return respond({"error": str(exc), "kind": "location"}, 2)
    except Exception as exc:
        return respond({"error": f"Could not resolve this location: {exc}", "kind": "location"}, 2)

    try:
        engine = engine_module.SkyEngine(location)
        snapshot = engine.snapshot()

        solar = []
        for position in snapshot.solar:
            events_error = None
            rise = set_time = transit = transit_altitude = None
            try:
                events = engine.events(position.obj, snapshot.time)
                rise = iso_utc(events.rise)
                set_time = iso_utc(events.set)
                transit = iso_utc(events.transit)
                transit_altitude = events.transit_alt
            except Exception as exc:
                events_error = str(exc)

            solar.append(
                {
                    "name": position.obj.name,
                    "kind": position.obj.kind,
                    "altitude": position.alt,
                    "azimuth": position.az,
                    "compass": position.compass,
                    "magnitude": position.obj.magnitude,
                    "magnitudeIsApproximate": position.obj.magnitude_is_approximate,
                    "isUp": position.is_up,
                    "rise": rise,
                    "set": set_time,
                    "transit": transit,
                    "transitAltitude": transit_altitude,
                    "eventsError": events_error,
                }
            )

        messier = [
            {
                "name": position.obj.name,
                "kind": position.obj.kind,
                "altitude": position.alt,
                "azimuth": position.az,
                "compass": position.compass,
                "magnitude": position.obj.magnitude,
                "isUp": position.is_up,
            }
            for position in snapshot.deep_sky
        ]

        constellation_views = engine.constellations_up(snapshot.time)
        constellations = []
        for view in constellation_views:
            brightest = view.stars[0]
            constellations.append(
                {
                    "name": view.name,
                    "visibleStarCount": len(view.stars),
                    "totalStarCount": view.total,
                    "direction": engine_module.az_to_compass(brightest.az),
                    "brightestStarAltitude": brightest.alt,
                    "brightestStarMagnitude": brightest.magnitude,
                }
            )

        solar_visible = sum(position["isUp"] for position in solar)
        messier_visible = sum(position["isUp"] for position in messier)
        timezone_name = getattr(location.tz, "key", "UTC")
        return respond(
            {
                "location": {
                    "name": location.name,
                    "latitude": location.lat,
                    "longitude": location.lon,
                    "timezone": timezone_name,
                },
                "observedAt": snapshot.time.utc_datetime().isoformat(timespec="seconds").replace(
                    "+00:00", "Z"
                ),
                "counts": {
                    "solarVisible": solar_visible,
                    "solarTotal": len(solar),
                    "deepSkyVisible": messier_visible,
                    "deepSkyTotal": len(messier),
                    "constellationsVisible": len(constellations),
                },
                "solar": solar,
                "messier": messier,
                "constellations": constellations,
            }
        )
    except engine_module.SkywatcherError as exc:
        return respond({"error": str(exc), "kind": "astronomy"}, 3)
    except Exception as exc:
        return respond(
            {"error": f"Skywatcher could not calculate the current sky: {exc}", "kind": "astronomy"},
            3,
        )


if __name__ == "__main__":
    raise SystemExit(main())
