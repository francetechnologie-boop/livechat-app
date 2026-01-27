import pg from "pg";

const { Pool } = pg;

export function createPool(options) {
  return new Pool(options);
}
