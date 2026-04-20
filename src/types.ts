import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type Database from "better-sqlite3";

export interface CustomerBridgeConfig {
  dbPath?: string;
  mergeThresholdAuto?: number;
  mergeThresholdReview?: number;
  vipExternalUserids?: string[];
  indexRefreshCron?: string;
  wechatMcpServerName?: string;
  wecomCorpId: string;
  wecomAgentId: string;
  wecomSecret: string;
}

export interface PluginContext {
  api: OpenClawPluginApi;
  config: CustomerBridgeConfig;
  db: Database.Database;
}

export type ChatClass =
  | "C1" | "C2"
  | "G1" | "G2" | "G3" | "G4"
  | "W1" | "W2" | "W3"
  | "N1" | "N2"
  | "X1"
  | "UNKNOWN";

export type BridgeMethod = "manual" | "phash" | "nickname" | "unionid_strict" | "phone";

export interface CustomerRow {
  primary_id: string;
  external_userid: string | null;
  wxid_legacy: string | null;
  unionid: string | null;
  phone_hash: string | null;
  avatar_phash: string | null;
  nickname_set: string;
  confidence: number;
  bridge_method: BridgeMethod | null;
  merged_from: string;
  created_at: number;
  updated_at: number;
}
