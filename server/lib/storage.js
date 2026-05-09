const fs = require("fs/promises");
const path = require("path");

const dataDir = path.join(process.cwd(), "data");
const dataFile = path.join(dataDir, "app-state.json");

const initialState = {
  users: [],
  sessions: [],
  orders: [],
  tickets: [],
  invoices: [],
  audit: []
};

async function ensureStore() {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(dataFile);
  } catch {
    await fs.writeFile(dataFile, JSON.stringify(initialState, null, 2), "utf8");
  }
}

async function readState() {
  await ensureStore();
  const raw = await fs.readFile(dataFile, "utf8");
  const parsed = JSON.parse(raw);
  return {
    ...initialState,
    ...parsed
  };
}

async function writeState(state) {
  await ensureStore();
  await fs.writeFile(dataFile, JSON.stringify(state, null, 2), "utf8");
}

async function updateState(mutator) {
  const state = await readState();
  const result = await mutator(state);
  await writeState(state);
  return result;
}

module.exports = {
  readState,
  updateState,
  writeState
};
