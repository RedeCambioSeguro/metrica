/**
 * Registro de providers.
 *
 * ADICIONAR UMA PLATAFORMA NOVA (LinkedIn Ads, YouTube, TikTok Ads...):
 *   1. Crie src/providers/<id>/index.ts implementando `MetricProvider`.
 *   2. Importe e adicione na lista PROVIDERS abaixo.
 *   3. Se a plataforma usar uma familia OAuth nova, adicione-a em families.ts.
 *
 * Nao ha passo 4. Sem migration, sem mexer no motor de sync, sem tocar no
 * builder de relatorios - todos leem daqui.
 */

import { googleAdsProvider } from "./google-ads";
import { googleAnalyticsProvider } from "./google-analytics";
import { googleBusinessProfileProvider } from "./google-business-profile";
import { googleSearchConsoleProvider } from "./google-search-console";
import { metaAdsProvider } from "./meta-ads";
import { getFamily } from "./families";
import type { MetricProvider, OAuthFamilyId } from "./types";

export const PROVIDERS: MetricProvider[] = [
  googleAnalyticsProvider,
  googleAdsProvider,
  metaAdsProvider,
  googleSearchConsoleProvider,
  googleBusinessProfileProvider,
];

const BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

export function getProvider(id: string): MetricProvider {
  const provider = BY_ID.get(id);
  if (!provider) {
    throw new Error(
      `Provider "${id}" nao registrado. Providers disponiveis: ${[...BY_ID.keys()].join(", ")}`,
    );
  }
  return provider;
}

export function tryGetProvider(id: string): MetricProvider | undefined {
  return BY_ID.get(id);
}

export function listProviders(): MetricProvider[] {
  return PROVIDERS;
}

export function listProvidersByFamily(family: OAuthFamilyId): MetricProvider[] {
  return PROVIDERS.filter((provider) => provider.family === family);
}

/**
 * Escopos a pedir ao autorizar uma familia.
 *
 * Pedimos os escopos de TODOS os providers da familia de uma vez: um unico
 * consentimento do Google ja libera GA4, Ads, Search Console e Meu Negocio,
 * em vez de mandar o cliente autorizar quatro vezes.
 *
 * Passe `providerIds` para pedir menos - util enquanto Google Ads e Meu
 * Negocio ainda nao estao aprovados, ja que escopo nao concedido no console
 * faz a tela de consentimento falhar inteira.
 */
export function scopesForFamily(
  familyId: OAuthFamilyId,
  providerIds?: string[],
): string[] {
  const family = getFamily(familyId);
  const providers = listProvidersByFamily(familyId).filter(
    (provider) => !providerIds || providerIds.includes(provider.id),
  );

  const scopes = new Set<string>(family.baseScopes);
  for (const provider of providers) {
    for (const scope of provider.scopes) scopes.add(scope);
  }
  return [...scopes];
}

/** Metadados leves para a UI, sem arrastar as funcoes de sync para o cliente. */
export interface ProviderSummary {
  id: string;
  name: string;
  family: OAuthFamilyId;
  brandColor: string;
  availability: MetricProvider["availability"];
  approvalNote?: string;
  metricCount: number;
}

export function listProviderSummaries(): ProviderSummary[] {
  return PROVIDERS.map((provider) => ({
    id: provider.id,
    name: provider.name,
    family: provider.family,
    brandColor: provider.brandColor,
    availability: provider.availability,
    approvalNote: provider.approvalNote,
    metricCount: provider.metrics.filter((m) => m.aggregation !== "ratio")
      .length,
  }));
}
