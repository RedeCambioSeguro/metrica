/**
 * Contrato de provedores de dados.
 *
 * Este arquivo e o unico ponto de acoplamento entre a plataforma e as APIs
 * externas. Adicionar LinkedIn Ads, YouTube ou TikTok Ads significa criar um
 * arquivo em src/providers/<id>/index.ts que implemente `MetricProvider` e
 * registra-lo em src/providers/registry.ts. Nada mais muda:
 *
 *   - nao ha migration de banco (MetricDaily e generica);
 *   - o motor de sync ja sabe agendar e gravar;
 *   - o builder de relatorios le `metrics` e `defaultBlocks` para montar a UI.
 */

export type OAuthFamilyId = "google" | "meta" | "linkedin" | "tiktok";

export type MetricFormat =
  | "integer"
  | "decimal"
  | "currency"
  | "percent"
  | "duration";

/**
 * Como consolidar a metrica quando varios dias viram um periodo.
 *
 * "unique" merece atencao: usuarios unicos NAO podem ser somados entre dias
 * (a mesma pessoa que voltou tres vezes viraria tres pessoas). Metricas assim
 * exigem uma consulta ao periodo inteiro na API - a camada de consulta trata
 * isso, e a UI marca o numero quando so houver a aproximacao diaria.
 */
export type Aggregation = "sum" | "avg" | "last" | "ratio" | "unique";

export interface MetricDefinition {
  /** Chave gravada em MetricDaily.metric. Unica dentro do provider. */
  key: string;
  label: string;
  format: MetricFormat;
  aggregation: Aggregation;
  /**
   * Metricas de razao (CTR, CPC, taxa de rejeicao) nao podem ser somadas nem
   * tiradas a media entre dias: precisam ser recalculadas a partir dos totais.
   * Ex.: ctr = { numerator: "clicks", denominator: "impressions", multiplier: 100 }
   */
  ratioOf?: {
    numerator: string;
    denominator: string;
    multiplier?: number;
  };
  /** Usado para pintar a variacao de verde/vermelho na comparacao de periodos. */
  higherIsBetter?: boolean;
  description?: string;
}

export interface DimensionDefinition {
  key: string;
  label: string;
  /**
   * Dimensoes de alta cardinalidade (paginas, termos de busca) sao truncadas
   * no top-N por dia antes de gravar, para nao inflar a tabela de metricas.
   */
  topNPerDay?: number;
}

/** Uma conta disponivel para vincular, retornada por `listAccounts`. */
export interface ExternalAccount {
  externalId: string;
  name: string;
  /** Contexto extra gravado em Connection.config (ex.: loginCustomerId do Google Ads). */
  config?: Record<string, unknown>;
  /** false para contas que existem mas nao podem ser sincronizadas (ex.: MCC). */
  selectable?: boolean;
  /** Rotulo de agrupamento na lista de selecao (ex.: nome da conta-mae). */
  group?: string;
}

/** Uma medicao. E a unidade que o motor de sync grava em MetricDaily. */
export interface MetricPoint {
  /** YYYY-MM-DD */
  date: string;
  metric: string;
  value: number;
  /** Recorte opcional: { campaign: "Black Friday" }, { device: "mobile" }... */
  dimensions?: Record<string, string>;
}

export interface ProviderLogger {
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export interface ListAccountsContext {
  accessToken: string;
  log: ProviderLogger;
}

export interface SyncContext {
  accessToken: string;
  connection: {
    id: string;
    externalId: string;
    externalName: string;
    config: Record<string, unknown>;
  };
  /** YYYY-MM-DD, inclusivo. */
  rangeStart: string;
  /** YYYY-MM-DD, inclusivo. */
  rangeEnd: string;
  timezone: string;
  log: ProviderLogger;
}

/** Bloco sugerido ao criar um relatorio novo com este provider. */
export interface BlockTemplate {
  type:
    | "section"
    | "text"
    | "kpi_row"
    | "time_series"
    | "table"
    | "donut"
    | "comparison";
  title: string;
  config: Record<string, unknown>;
}

/**
 * Estado de liberacao da API. A plataforma exibe isso na tela de conexoes
 * para deixar claro por que um provider ainda nao puxa dados reais.
 */
export type ProviderAvailability = "ready" | "needs_api_approval" | "planned";

export interface MetricProvider {
  /** Gravado em Connection.provider. Nunca mude depois de ir para producao. */
  id: string;
  name: string;
  family: OAuthFamilyId;
  brandColor: string;
  availability: ProviderAvailability;
  /** Explica ao usuario qual aprovacao falta, quando availability != "ready". */
  approvalNote?: string;
  /** Escopos OAuth exigidos por ESTE provider, somados aos da familia. */
  scopes: string[];
  metrics: MetricDefinition[];
  dimensions: DimensionDefinition[];
  defaultBlocks: BlockTemplate[];

  /** Lista as contas que a credencial enxerga, para o usuario escolher. */
  listAccounts(ctx: ListAccountsContext): Promise<ExternalAccount[]>;

  /** Busca as metricas do periodo. Deve ser puro: nao grava no banco. */
  sync(ctx: SyncContext): Promise<MetricPoint[]>;
}

/** Helper para achar a definicao de uma metrica sem repetir find() por toda parte. */
export function findMetric(
  provider: MetricProvider,
  key: string,
): MetricDefinition | undefined {
  return provider.metrics.find((m) => m.key === key);
}
