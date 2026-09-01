import { NextResponse } from "next/server";
import { readProviders, readSelection } from "@app/shared/llm/config.js";
import { fetchAllBalances } from "@app/shared/llm/balance.js";

interface BalanceEntry {
  provider: string;
  status: "ok" | "error" | "unknown";
  available: boolean | null;
  balanceText?: string;
  note?: string;
  error?: string;
}

export async function GET() {
  const providers = readProviders() as Record<string, { enabled?: boolean }>;
  const selection = readSelection() as Record<string, { provider?: string; model?: string }>;

  const ids = Object.keys(providers);
  const balances = (await fetchAllBalances(ids)) as BalanceEntry[];
  const byProvider: Record<string, BalanceEntry> = {};
  for (const b of balances) byProvider[b.provider] = b;

  const providerList = ids.map((id) => ({
    id,
    enabled: providers[id]?.enabled !== false,
    ...byProvider[id],
  }));

  const modules: Record<string, { provider: string; model: string; available: boolean | null }> = {};
  for (const [mod, sel] of Object.entries(selection)) {
    if (!sel?.provider) continue;
    const enabled = providers[sel.provider]?.enabled !== false;
    modules[mod] = {
      provider: sel.provider,
      model: sel.model || "",
      available: enabled ? byProvider[sel.provider]?.available ?? null : false,
    };
  }

  return NextResponse.json({ providers: providerList, modules });
}
