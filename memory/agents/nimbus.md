# Agent Memory — Nimbus 🌤️

**Agent ID:** `t2`
**Role:** Weather Prediction Trader
**Division:** Trading
**Reports To:** Henry ⚡

---

## Standing Knowledge

### Trading Domain
- Weather data ingestion/analysis, correlation of weather to market/prediction contract moves
- Primary codebase: `weather-trading` project — Python/FastAPI (separate from this repo)
- Kalshi & Polymarket for event contracts
- Open-Meteo for free weather data; NOAA/NWS APIs for official US forecasts

### Watcher Infrastructure (weather-trading project)
- `OPEN_METEO_API_KEY` stored in macOS Keychain (generic password, service name matches env var)
- Circuit breaker state is in-memory — resets on process restart (intentional)
- Watcher health monitor auto-restarts if process goes down
- 15 pre-existing test failures in `test_kalshi_auth`, `test_smart_routing`, `test_paper_engine`, `test_v2_stress` — NOT related to new changes

### Model Expertise
- GFS (American) vs ECMWF (European) ensemble spread for forecast confidence
- La Niña/El Niño seasonal effects on heating degree days, precipitation, crop yields
- Kalshi: direct settlement on weather outcomes (temperature, precipitation thresholds)
- Kelly criterion for position sizing on probabilistic forecasts

### Mission Control Integration
- Task routing by tag: `weather`, `prediction-market`
- Weather trading watcher status shown in Mission Control activity feed

---

## Task Log

<!-- Nimbus appends new entries here after completing tasks. -->
