import { newId } from "../../../shared/id";
import { parseImportedMacro } from "../../../shared/macro";
import type { Macro } from "../../types";
import type { MacroStore } from "../types";
import type { RpcClient } from "./bridge";

export class RpcMacroStore implements MacroStore {
  private rpc: RpcClient;

  constructor(rpc: RpcClient) {
    this.rpc = rpc;
  }

  async list(): Promise<Macro[]> {
    return this.rpc.call("store.list", {});
  }

  async save(macro: Macro): Promise<void> {
    await this.rpc.call("store.save", { macro });
  }

  async rename(id: string, name: string): Promise<void> {
    await this.rpc.call("store.rename", { id, name });
  }

  async remove(id: string): Promise<void> {
    await this.rpc.call("store.remove", { id });
  }

  async importMacro(json: string): Promise<Macro> {
    const macro = parseImportedMacro(json, newId);
    await this.save(macro);
    return macro;
  }

  exportMacro(macro: Macro): string {
    return JSON.stringify(macro, null, 2);
  }
}
