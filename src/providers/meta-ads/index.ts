/**
 * Meta Ads (Facebook e Instagram) - Marketing API / Insights.
 *
 * Pre-requisitos que NAO sao codigo:
 *   1. App no Meta for Developers com o produto "Marketing API".
 *   2. Verificacao do negocio (CNPJ e documentos) no Business Manager.
 *   3. App Review para os escopos `ads_read` e `business_management`. Sem isso,
 *      o app so enxerga contas de quem tem cargo nele (admin/dev/tester) - o
 *      que basta para uso interno, mas nao para atender clientes externos.
 *
 * Atencao aos tokens: o Meta nao usa refresh_token. O token curto retornado no
 * callback precisa ser trocado por um de longa duracao (~60 dias) e renovado
 * antes de expirar - ver src/server/oauth/tokens.ts.
 */

import { apiFetch } from "../http";
import type {
  ExternalAccount,
  ListAccountsContext,
  MetricPoint,
  MetricProvider,
  SyncContext,
} from "../types";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const API = `https://graph.facebook.com/${API_VERSION}`;

interface Paged<T> {
  data?: T[];
  paging?: { next?: string };
}

interface AdAccount {
  id?: string; // "act_123456"
  account_id?: string;
  name?: string;
  account_status?: number;
  currency?: string;
  business?: { id?: string; name?: string };
}

interface InsightRow {
  date_start?: string;
  impressions?: string;
  clicks?: string;
  spend?: string;
  reach?: string;
  inline_link_clicks?: string;
  campaign_name?: string;
  actions?: Array<{ action_type?: string; value?: string }>;
  action_values?: Array<{ action_type?: string; value?: string }>;
}

/**
 * Tipos de acao do Meta que viram metricas nomeadas.
 * O Meta devolve dezenas de action_types; sem essa curadoria o relatorio
 * viraria uma lista ilegivel.
 */
const ACTION_METRICS: Record<string, string> = {
  link_click: "linkClicks",
  landing_page_view: "landingPageViews",
  lead: "leads",
  "offsite_conversion.fb_pixel_lead": "leads",
  purchase: "purchases",
  "offsite_conversion.fb_pixel_purchase": "purchases",
  "offsite_conversion.fb_pixel_add_to_cart": "addToCart",
  "offsite_conversion.fb_pixel_initiate_checkout": "initiateCheckout",
  "onsite_conversion.messaging_conversation_started_7d": "conversationsStarted",
  post_engagement: "postEngagement",
  page_engagement: "pageEngagement",
  video_view: "videoViews",
};

const ACTION_VALUE_METRICS: Record<string, string> = {
  purchase: "purchaseValue",
  "offsite_conversion.fb_pixel_purchase": "purchaseValue",
};

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Percorre todas as paginas do cursor do Graph API. */
async function fetchAllPages<T>(
  firstUrl: string,
  label: string,
): Promise<T[]> {
  const items: T[] = [];
  let url: string | undefined = firstUrl;
  let guard = 0;

  while (url && guard < 200) {
    const page: Paged<T> = await apiFetch<Paged<T>>(url, {
      label,
      method: "GET",
    });
    items.push(...(page.data ?? []));
    url = page.paging?.next;
    guard++;
  }

  return items;
}

function insightToPoints(
  row: InsightRow,
  dimensions?: Record<string, string>,
): MetricPoint[] {
  const date = row.date_start;
  if (!date) return [];

  const points: MetricPoint[] = [];
  const push = (metric: string, value: number) =>
    points.push({ date, metric, value, dimensions });

  push("impressions", num(row.impressions));
  push("clicks", num(row.clicks));
  push("spend", num(row.spend));
  push("reach", num(row.reach));
  push("linkClicks", num(row.inline_link_clicks));

  // Acoes: soma por metrica nomeada (varios action_types mapeiam para o mesmo
  // nome, ex.: `lead` e `offsite_conversion.fb_pixel_lead` -> leads).
  const totals = new Map<string, number>();
  for (const action of row.actions ?? []) {
    const metric = ACTION_METRICS[action.action_type ?? ""];
    if (!metric) continue;
    totals.set(metric, (totals.get(metric) ?? 0) + num(action.value));
  }
  for (const action of row.action_values ?? []) {
    const metric = ACTION_VALUE_METRICS[action.action_type ?? ""];
    if (!metric) continue;
    totals.set(metric, (totals.get(metric) ?? 0) + num(action.value));
  }
  for (const [metric, value] of totals) push(metric, value);

  return points;
}

export const metaAdsProvider: MetricProvider = {
  id: "meta_ads",
  name: "Meta Ads",
  family: "meta",
  brandColor: "#0866FF",
  availability: "needs_api_approval",
  approvalNote:
    "Exige verificacao do negocio e App Review dos escopos ads_read e business_management. Antes disso, apenas contas ligadas a pessoas com cargo no app retornam dados.",
  scopes: ["ads_read", "business_management", "read_insights"],

  metrics: [
    {
      key: "spend",
      label: "Investimento",
      format: "currency",
      aggregation: "sum",
      higherIsBetter: false,
    },
    {
      key: "impressions",
      label: "Impressoes",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "reach",
      label: "Alcance",
      format: "integer",
      aggregation: "unique",
      higherIsBetter: true,
      description: "Pessoas unicas. Somar os dias superestima o periodo.",
    },
    {
      key: "clicks",
      label: "Cliques",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "linkClicks",
      label: "Cliques no link",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "landingPageViews",
      label: "Visualizacoes da pagina de destino",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "leads",
      label: "Leads",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "purchases",
      label: "Compras",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "purchaseValue",
      label: "Valor das compras",
      format: "currency",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "conversationsStarted",
      label: "Conversas iniciadas",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "postEngagement",
      label: "Engajamento com a publicacao",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "videoViews",
      label: "Visualizacoes de video",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    // --- Razoes ---
    {
      key: "ctr",
      label: "CTR",
      format: "percent",
      aggregation: "ratio",
      higherIsBetter: true,
      ratioOf: {
        numerator: "clicks",
        denominator: "impressions",
        multiplier: 100,
      },
    },
    {
      key: "cpc",
      label: "CPC",
      format: "currency",
      aggregation: "ratio",
      higherIsBetter: false,
      ratioOf: { numerator: "spend", denominator: "clicks" },
    },
    {
      key: "cpm",
      label: "CPM",
      format: "currency",
      aggregation: "ratio",
      higherIsBetter: false,
      ratioOf: {
        numerator: "spend",
        denominator: "impressions",
        multiplier: 1000,
      },
    },
    {
      key: "costPerLead",
      label: "Custo por lead",
      format: "currency",
      aggregation: "ratio",
      higherIsBetter: false,
      ratioOf: { numerator: "spend", denominator: "leads" },
    },
    {
      key: "roas",
      label: "ROAS",
      format: "decimal",
      aggregation: "ratio",
      higherIsBetter: true,
      ratioOf: { numerator: "purchaseValue", denominator: "spend" },
    },
  ],

  dimensions: [{ key: "campaign", label: "Campanha", topNPerDay: 50 }],

  defaultBlocks: [
    {
      type: "kpi_row",
      title: "Resumo do Meta Ads",
      config: { metrics: ["spend", "impressions", "linkClicks", "leads", "costPerLead"] },
    },
    {
      type: "time_series",
      title: "Investimento e resultados",
      config: { metrics: ["spend", "leads"] },
    },
    {
      type: "table",
      title: "Desempenho por campanha",
      config: {
        dimension: "campaign",
        metrics: ["spend", "impressions", "linkClicks", "ctr", "leads", "costPerLead"],
        limit: 20,
        sortBy: "spend",
      },
    },
  ],

  async listAccounts({ accessToken }: ListAccountsContext): Promise<ExternalAccount[]> {
    const url = new URL(`${API}/me/adaccounts`);
    url.searchParams.set(
      "fields",
      "id,account_id,name,account_status,currency,business{id,name}",
    );
    url.searchParams.set("limit", "200");
    url.searchParams.set("access_token", accessToken);

    const accounts = await fetchAllPages<AdAccount>(
      url.toString(),
      "Meta adaccounts",
    );

    return accounts
      .filter((account) => Boolean(account.id))
      .map((account) => ({
        externalId: account.id!, // ja vem no formato act_123456
        name: account.name ?? account.id!,
        group: account.business?.name ?? undefined,
        // account_status 1 = ativa, 2 = desabilitada, 3 = nao paga...
        selectable: account.account_status === 1,
        config: {
          currency: account.currency,
          accountStatus: account.account_status,
          businessId: account.business?.id,
        },
      }));
  },

  async sync(ctx: SyncContext): Promise<MetricPoint[]> {
    const { accessToken, connection, rangeStart, rangeEnd, log } = ctx;
    const actId = connection.externalId.startsWith("act_")
      ? connection.externalId
      : `act_${connection.externalId}`;

    const baseFields = [
      "impressions",
      "clicks",
      "spend",
      "reach",
      "inline_link_clicks",
      "actions",
      "action_values",
    ];

    const buildUrl = (level: "account" | "campaign"): string => {
      const url = new URL(`${API}/${actId}/insights`);
      url.searchParams.set(
        "fields",
        level === "campaign"
          ? [...baseFields, "campaign_name"].join(",")
          : baseFields.join(","),
      );
      url.searchParams.set(
        "time_range",
        JSON.stringify({ since: rangeStart, until: rangeEnd }),
      );
      // time_increment=1 quebra o resultado dia a dia, que e o que a nossa
      // tabela de metricas espera.
      url.searchParams.set("time_increment", "1");
      url.searchParams.set("level", level);
      url.searchParams.set("limit", "500");
      url.searchParams.set("access_token", accessToken);
      return url.toString();
    };

    const points: MetricPoint[] = [];

    const accountRows = await fetchAllPages<InsightRow>(
      buildUrl("account"),
      "Meta insights (conta)",
    );
    for (const row of accountRows) points.push(...insightToPoints(row));

    const campaignRows = await fetchAllPages<InsightRow>(
      buildUrl("campaign"),
      "Meta insights (campanha)",
    );
    for (const row of campaignRows) {
      if (!row.campaign_name) continue;
      points.push(...insightToPoints(row, { campaign: row.campaign_name }));
    }

    log.info(`Meta Ads: ${points.length} pontos coletados`, { actId });
    return points;
  },
};
