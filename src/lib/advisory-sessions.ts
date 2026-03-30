import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data", "advisory");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadAdvisorySessions() {
  ensureDir();
  const files = fs.readdirSync(DATA_DIR).filter((file) => file.endsWith(".json"));
  return files
    .map((file) => {
      try {
        const raw = fs.readFileSync(path.join(DATA_DIR, file), "utf-8");
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getAdvisorySessionsList() {
  return loadAdvisorySessions().map(({ events: _events, ...rest }) => ({
    ...rest,
    eventCount: _events?.length ?? 0,
    lastEvent: _events?.length ? _events[_events.length - 1] : null,
  }));
}
