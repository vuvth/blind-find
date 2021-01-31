import * as os from "os";
import * as path from "path";

export const blindFindDir = path.join(os.homedir(), ".blind_find");
export const dbDir = path.join(blindFindDir, "db");
export const configsPath = path.join(blindFindDir, "configs.yaml");
export const network = "kovan";
export const provider = "infura";
const hour = 3600 * 1000; // 3600s
export const defaultHubRateLimit = {
  join: { numAccess: 100, refreshPeriod: hour }, // 100 joins per hour
  search: { numAccess: 100, refreshPeriod: hour }, // 100 searches per hour
  global: { numAccess: 200, refreshPeriod: hour } // 100 joins per hour
};
