/**
 * Google Search Console (Search Analytics API v3).
 *
 * Duas particularidades que afetam o relatorio:
 *
 * 1. Os dados tem atraso de 2 a 3 dias. Sincronizar "ontem" costuma voltar
 *    vazio, e o motor de sync re-sincroniza a janela recente por isso.
 * 2. A posicao media NAO pode ser tirada a media entre dias: dias com poucas
 *    impressoes pesariam igual a dias de pico. Gravamos `positionWeighted`
 *    (posicao x impressoes) e dividimos pelas impressoes do periodo.
 */

import { getJson, postJson } from "../http";
import type {
  ExternalAccount,
  ListAccountsContext,
  MetricPoint,
  MetricProvider,
  SyncContext,
} from "../types";

const API = "https://www.googleapis.com/webmasters/v3";

interface SitesResponse {
  siteEntry?: Array<{
    siteUrl?: string;
    permissionLevel?: string;
  }>;
}

interface SearchAnalyticsRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

interface SearchAnalyticsResponse {
  rows?: SearchAnalyticsRow[];
}

const ROW_LIMIT = 25_000;

async function querySearchAnalytics(
  accessToken: string,
  siteUrl: string,
  body: Record<string, unknown>,
  label: string,
): Promise<SearchAnalyticsRow[]> {
  const rows: SearchAnalyticsRow[] = [];
  let startRow = 0;

  for (;;) {
    const page = await postJson<SearchAnalyticsResponse>(
      `${API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      accessToken,
      { ...body, rowLimit: ROW_LIMIT, startRow },
      label,
    );

    const batch = page.rows ?? [];
    rows.push(...batch);

    if (batch.length < ROW_LIMIT) break;
    startRow += ROW_LIMIT;
  }

  return rows;
}

/**
 * Converte linhas do Search Console em pontos.
 * A primeira chave e sempre `date`; as demais viram dimensoes nomeadas.
 */
function rowsToPoints(
  rows: SearchAnalyticsRow[],
  extraDimensionKeys: string[],
): MetricPoint[] {
  const points: MetricPoint[] = [];

  for (const row of rows) {
    const keys = row.keys ?? [];
    const date = keys[0];
    if (!date) continue;

    let dimensions: Record<string, string> | undefined;
    if (extraDimensionKeys.length) {
      dimensions = {};
      extraDimensionKeys.forEach((key, i) => {
        dimensions![key] = keys[i + 1] ?? "(nao definido)";
      });
    }

    const clicks = row.clicks ?? 0;
    const impressions = row.impressions ?? 0;
    const position = row.position ?? 0;

    points.push({ date, metric: "clicks", value: clicks, dimensions });
    points.push({ date, metric: "impressions", value: impressions, dimensions });
    // Componente somavel para a posicao media exata do periodo.
    points.push({
      date,
      metric: "positionWeighted",
      value: position * impressions,
      dimensions,
    });
  }

  return points;
}

function topNPerDay(
  points: MetricPoint[],
  rankMetric: string,
  n: number,
): MetricPoint[] {
  // Agrupa por (data + chave de dimensao) para manter as tres metricas juntas.
  const groups = new Map<string, { rank: number; points: MetricPoint[] }>();

  for (const p of points) {
    const dimKey = JSON.stringify(p.dimensions ?? {});
    const groupKey = `${p.date}|${dimKey}`;
    const group = groups.get(groupKey) ?? { rank: 0, points: [] };
    group.points.push(p);
    if (p.metric === rankMetric) group.rank = p.value;
    groups.set(groupKey, group);
  }

  const byDate = new Map<string, Array<{ rank: number; points: MetricPoint[] }>>();
  for (const [groupKey, group] of groups) {
    const date = groupKey.split("|")[0];
    const list = byDate.get(date) ?? [];
    list.push(group);
    byDate.set(date, list);
  }

  const kept: MetricPoint[] = [];
  for (const list of byDate.values()) {
    list.sort((a, b) => b.rank - a.rank);
    for (const group of list.slice(0, n)) kept.push(...group.points);
  }
  return kept;
}

export const googleSearchConsoleProvider: MetricProvider = {
  id: "google_search_console",
  name: "Google Search Console",
  family: "google",
  brandColor: "#4285F4",
  availability: "ready",
  scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],

  metrics: [
    {
      key: "clicks",
      label: "Cliques",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "impressions",
      label: "Impressoes",
      format: "integer",
      aggregation: "sum",
      higherIsBetter: true,
    },
    {
      key: "positionWeighted",
      label: "Posicao ponderada",
      format: "decimal",
      aggregation: "sum",
      description:
        "Componente interno (posicao x impressoes). Nao exibir em relatorio.",
    },
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
      key: "position",
      label: "Posicao media",
      format: "decimal",
      aggregation: "ratio",
      higherIsBetter: false,
      ratioOf: {
        numerator: "positionWeighted",
        denominator: "impressions",
      },
    },
  ],

  dimensions: [
    { key: "query", label: "Termo de busca", topNPerDay: 50 },
    { key: "page", label: "Pagina", topNPerDay: 50 },
    { key: "country", label: "Pais" },
    { key: "device", label: "Dispositivo" },
  ],

  defaultBlocks: [
    {
      type: "kpi_row",
      title: "Desempenho na busca",
      config: { metrics: ["clicks", "impressions", "ctr", "position"] },
    },
    {
      type: "time_series",
      title: "Cliques e impressoes",
      config: { metrics: ["clicks", "impressions"] },
    },
    {
      type: "table",
      title: "Principais termos de busca",
      config: {
        dimension: "query",
        metrics: ["clicks", "impressions", "ctr", "position"],
        limit: 20,
        sortBy: "clicks",
      },
    },
    {
      type: "table",
      title: "Paginas mais acessadas pela busca",
      config: {
        dimension: "page",
        metrics: ["clicks", "impressions", "ctr", "position"],
        limit: 15,
        sortBy: "clicks",
      },
    },
  ],

  async listAccounts({ accessToken }: ListAccountsContext): Promise<ExternalAccount[]> {
    const data = await getJson<SitesResponse>(
      `${API}/sites`,
      accessToken,
      "Search Console sites",
    );

    return (data.siteEntry ?? [])
      .filter((site) => Boolean(site.siteUrl))
      .map((site) => ({
        externalId: site.siteUrl!,
        name: site.siteUrl!.replace(/^sc-domain:/, "").replace(/\/$/, ""),
        // "siteUnverifiedUser" nao consegue ler dados.
        selectable: site.permissionLevel !== "siteUnverifiedUser",
        config: { permissionLevel: site.permissionLevel },
      }));
  },

  async sync(ctx: SyncContext): Promise<MetricPoint[]> {
    const { accessToken, connection, rangeStart, rangeEnd, log } = ctx;
    const siteUrl = connection.externalId;
    const base = {
      startDate: rangeStart,
      endDate: rangeEnd,
      type: "web",
      dataState: "final" as const,
    };
    const points: MetricPoint[] = [];

    // 1) Totais por dia.
    points.push(
      ...rowsToPoints(
        await querySearchAnalytics(
          accessToken,
          siteUrl,
          { ...base, dimensions: ["date"] },
          "GSC totais",
        ),
        [],
      ),
    );

    // 2) Termos de busca (alta cardinalidade).
    points.push(
      ...topNPerDay(
        rowsToPoints(
          await querySearchAnalytics(
            accessToken,
            siteUrl,
            { ...base, dimensions: ["date", "query"] },
            "GSC por termo",
          ),
          ["query"],
        ),
        "clicks",
        50,
      ),
    );

    // 3) Paginas.
    points.push(
      ...topNPerDay(
        rowsToPoints(
          await querySearchAnalytics(
            accessToken,
            siteUrl,
            { ...base, dimensions: ["date", "page"] },
            "GSC por pagina",
          ),
          ["page"],
        ),
        "clicks",
        50,
      ),
    );

    // 4) Dispositivo (baixa cardinalidade, grava tudo).
    points.push(
      ...rowsToPoints(
        await querySearchAnalytics(
          accessToken,
          siteUrl,
          { ...base, dimensions: ["date", "device"] },
          "GSC por dispositivo",
        ),
        ["device"],
      ),
    );

    log.info(`Search Console: ${points.length} pontos coletados`, { siteUrl });
    return points;
  },
};
